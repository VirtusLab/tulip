Project Tulip

# Project scope

The goal of the tool is present a PR to a human reviewer. All changes should be
grouped by functionality / type, and explained step-by-step, in a
programmer-friendly way. The reviewer should be able to focus on the most
important details, and drill-down to the specific source code parts on-demand.
We want to capture the essence of the PR, the bits that really matter - by
grouping functionalities, surfacing most high-impact changes and presenting
them.

# Command-line

The tool should be implemented in TypeScript, runnable from the command line -
first processing the PR using an LLM process, then presenting the findings on a
web page. 

The user invocation is: `tulip <PR URL>`.

# Analysis

The analysis and generation should proceed in a number of phases. 

## Phase 1: generating categories

The first phase is priming an LLM session with the PR’s title, description and
list of files, and asking it to produce a list of categories, into which the
changes can be group. Each group should be a self-contained change. An ideal PR
might be a single category, but this rarely happens. Larger PRs, even when
implementing a single functionality, should be split into several
sub-categories. So the task of the LLM is to generate a list of categories which
can be cohesively presented to the user, but which won’t have too much changes.
This should be done using a middle-tier LLM model (sonnet).

The categories should be ordered, as they should be presented to the user: the
most important, high-impact ones first. 

## Phase 2: categorizing code

Next, after obtaining the list of categories, use a cheap LLM model (haiku) to
classify ALL changes into one (or more) of categories. A change is identified by
the file + line range (can be entire file), as in the diff. This might also
point to deleted content. A change might be removal change of lines, or adding
new lines.

Each change should be fed into the LLM, along with the list of possible
categories. In return, the LLM should produce a mapping of (change, line range)
-> (category, code type). A single change can have multiple categories, that’s
fine. The "code type" is either "production" or "test" - so we want to separate
production & test code. After this is done, verify that all lines are covered by
at least one category. If that's not the case, ask the classifying agent to
classify the missing changes.

As an escape hatch, give the classifying model the opportunity to pick a "none"
category, along with a suggested new category name (the initial prompt should
explain, what categories are). When this happens, consult the original
category-creating session if the proposed new category, for the given change
(lines) is appropriate. If so, continue the classifying process with updated
categories. Otherwise, tell the classifying model to pick from one of the
current categories.

Also, a change might be classified as "ignore". This is designed for generated
files, lockfiles, binaries, anything that wouldn't be reviewed by humans anyway.
Such changes should be excluded from all future considerations.

## Phase 3: generate explanations for categories

Then, for each category in turn, we need to generated explanation to the user.
Create a fresh LLM session for category. Use a high-capability model (opus) to
generate the explanations. The session should be given the PR title,
description, explanation of what we’re doing: explaining part of the PR so that
the user can efficiently review the changes, and that other categories will
follow. Finally, the context of the session should be fed with the category name
and the picked changes (not necessarily entire diffs, as these can be large, but
either diffs or file names + line ranges, depending on a configurable
threshold). 

To explain the implementation behind a category, the model should produce prose
alongside diagrams and commented code snippets. Each explanation should be
divided between production code, and test code, which describes the testing
strategy taken. Everything MUST be grounded in the code, through the provided
diffs.

An explanation for a category should contain (if appropriate):
* how it relates to the PRs title / description
* what is implemented - what kind of functionality
* what are the main algorithms / data structures used
* what are the external services that are being used, and how
* what’s the complexity of the code - memory & CPU-wise
* does it touch mutable state, global mutable state, what are the side-effects
  of running the code
* present original & changed call-stack diagrams (sequences of method calls) as
  diagrams to easily visualise the old & new changes
* are any new dependencies introduced, and why
* is it a refactoring - if so, the category might be trivial to review
* what are the refactorings involved when implementing the change
* is there any documentation, and if so, what kind

For test code, the aspects to consider are:
* are the tests unit tests / integration tests
* do they exercise the functionality as a whole
* do they overlap
* do they require any external resources
* what’s the testing approach taken - are there property, mutation tests etc.

It’s up to the explaining LLM session to judge, which parts of the above should
be presented. The explaining LLM should be prompted to first research the
changes, then analyze how they work, creating intermediate scratch notes if
necessary. Then, it produce the analysis, interleaving explanation prose with
diagrams and code snippets. It’s crucial that ALL originally provided code
snippets end up somewhere in the explanation.

Each explanation should be reviewed using a fresh session (a subagent) for:
clarity, conciseness and correctness. Of course, the subagent should be prompted
with appropriate context. If there are any issues to fix, they should be
introduced, and a re-review should run, up to 3 times.

The generated code snippets should simply be references to files & line ranges,
rendered using special markup that is introduced in the prompt. The renderer
will later substitute them for real code. That way, after the explanation is
generated, we’ll be able to verify if all code snippets have been covered, and
are present in the explanation at some point. If that’s not the case, the
explaining session should be resumed and asked to amend the explanation with the
missing code ranges. Each code snippet should also carry information if it
should be unfolded by default, or not (if it’s a "supporting" change, not
crucial to understanding the whole picture).

The explanations should focus on ease-of-understanding and conciseness. The
explaining agent should be encouraged to use diagrams generously, as well as
pseudo-code if needed.

## General LLM gudielines

At all times, for all LLM usage, include a preamble that instructs the LLM to
be:
* short and to the point
* avoiding jargon
* using simple words
* explain fact in simple terms, avoiding sounding smart

# Rendering

After all categories are explained, the results should be rendered to an HTML
page. There should be a single template, which allows switching between
light/dark themes, with a floating table-of-contents and a programmer-friendly
font, narrow layout so that reading is easy. The code snippets should be
unfoldable github-style, so that you can view the changes side-by-side,
presenting the original & changed versions, with an option to expand the context
up/down github-style. All the diagrams should be nicely rendered.

The template should come with the appropriate styling, fonts, diagramming
dependencies (Mermaid) etc., so that this doesn’t need to be generated each
time.

# LLM integration

The LLM integration should be first done using Claude Code. If possible, instead
of using the API, all integration should be based on running the `claude`
command-line in headless mode (`-p`). Hence the tool assumes that a configured &
logged-in `claude` is available. Structured outputs should be used (by providing
a JSON schema) to obtain the required answers. Sessions should be resumed where
appropriate.

Run up to 3 concurrent claude sessions concurrently.

# Result

A result should be temporary directory with the ready HTML page, alongside
instructions on how to open it in the browser. The tool should log information
as it processes the PR, with reasonable verbosity, letting the user know about
the phases, generated categories, for which category an explanation is
generated, etc.

# Technical notes

The PR should be fetched using `gh` if available, otherwise http should be
attempted. Create a temporary checkout to run the analysis efficiently.

Use the latest Node LTS and a state-of-the art package manager & testing
framework.

Checkpointing & resumability will be a later concern.