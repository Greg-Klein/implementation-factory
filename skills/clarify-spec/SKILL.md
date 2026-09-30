---
name: clarify-spec
description: Turn a software request and its source documents into established requirements, explicit assumptions, contradictions and decision questions before planning or when a specification gap appears. Does not choose missing product decisions, change tickets or implement code.
---

# Clarify a specification

Input: request, source documents, current explicit decisions and caller's source-precedence policy. Return established requirements with sources, out of scope, resolved contradictions and open decisions. Do not invent a universal document hierarchy if none is supplied.

1. For each requested behavior, identify actors, inputs, states, outputs and failure conditions needed to implement it. Read relevant repository conventions and supplied references; mark inaccessible sources.
2. Separate a contradiction from a detail omitted by a higher-level source. Apply the caller's precedence policy; preserve an explicit later decision and record the arbitration. Escalate a conflict whose intended authority remains unclear.
3. Distinguish an established requirement, a sourced technical inference and an unresolved product choice. Existing conventions can settle an implementation detail, but cannot create permission rules, limits, endpoints or user-facing copy absent from the request.
4. Ask only questions whose alternatives materially change the result, through the caller's interaction channel. Give concrete options and their consequences. Reuse answers already supplied.
5. Propose testable acceptance wording without silently changing meaning. When a registry is supplied, preserve its ids and revision; propose additions as questions for its owner.

Stop with useful partial findings when sources are missing. Return questions to the caller rather than blocking unrelated work or answering on the user's behalf.
