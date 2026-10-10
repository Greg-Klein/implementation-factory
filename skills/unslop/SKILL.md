---
name: unslop
description: >-
  Cut AI tells from prose, in French or English. Use for docs, READMEs, MR descriptions, tickets,
  Slack messages, blog posts, any non-code text that should read like a person wrote it.
  Triggers: "unslop", "humanize", "dé-IA ce texte", "ça sonne IA", "rends ça naturel", "make this
  sound human", "clean up this writing". Applies while drafting as well as to existing text.
---

# Unslop

Edit text to remove AI patterns. Adapted from poteto's `unslop` (cursor/plugins, pstack), extended
to French and to the house rules below.

When a contract fixes the output format (headings, table columns, JSON keys, verdict tokens, commit
prefixes, required language), keep that format exactly and apply these rules to the sentences.

## Process

1. Identify the register: technical (ticket, MR, doc), conversational (Slack), editorial (blog,
   thread).
2. Scan for the house rules, then the patterns below.
3. Rewrite. Preserve meaning, facts, links, code identifiers, the language of the source and its
   intended tone. Never add a claim, a number or an opinion the source does not support.
4. Self-audit: "What still makes this obviously AI generated?" Fix the remaining tells.
5. Return the rewritten text. List the main changes only if asked.

Rule numbers are stable ids. A removed rule leaves a gap.

## House rules (non-negotiable)

- **H1. No em-dash (`—`) or en-dash (`–`).** Use a full stop, a comma, parentheses, or a colon
  before a list. A Markdown bullet `-` is fine.
- **H2. No counterbalancing.** Never « ce n'est pas X, c'est Y », « il ne s'agit pas de X mais
  de Y », « moins X que Y », « non pas X, plutôt Y », "not just X, but Y". State Y directly.
- **H3. No inclusive writing in French.** No middle dot, no « celles et ceux », no doublets.
  Generic masculine or a neutral wording.
- **H4. Quotes.** Guillemets « » with spaces in French text, straight quotes in English text and
  in code. No curly quotes.

## Patterns to detect and fix

### Content

3. **Superficial participle tails.** « ..., permettant ainsi de », « ..., garantissant »,
   « ..., offrant », "highlighting...", "ensuring...", "showcasing...". Delete, or turn it into a
   sentence with a real consequence.
4. **Significance inflation and promotion.** « joue un rôle clé », « au cœur de », « s'inscrit
   dans une démarche », « robuste », « fluide », « intuitif », « de pointe », "pivotal moment",
   "testament to", "seamless". State what happened, with a measurable description.
5. **Vague attributions.** « Les experts s'accordent », « de nombreux utilisateurs », "Experts
   believe". Name the source or delete.

### Language

7. **AI vocabulary.**
   - FR: crucial, essentiel, primordial, optimiser, levier, enjeu, écosystème (abstrait), paysage
     (abstrait), véritable, incontournable, fluidifier, booster, plonger dans, « en termes de »,
     « au niveau de » (non spatial).
   - EN: additionally, crucial, delve, enduring, enhance, foster, garner, interplay, intricate,
     landscape, pivotal, showcase, tapestry, testament, underscore, vibrant.
   Replace with plain words.
8. **Fancy ways to say "is".** « se positionne comme », « constitue », « fait office de »,
   « représente », "serves as", "stands as", "boasts". Write « est » / « a », "is" / "has".
10. **Rule of three.** Forcing ideas into groups of three. Use the natural number.
11. **Synonym cycling.** « le composant / l'élément / le module » for the same thing. Pick one term
    and repeat it.
12. **False ranges.** « de X à Y » where X and Y are not on a scale. List the items.
34. **Nominalisation.** « procéder à la mise en place de » becomes « mettre en place »,
    « effectuer une vérification » becomes « vérifier ». Prefer the verb.
35. **Connector stacking.** « De plus, », « Par ailleurs, », « En outre, », « Ainsi, »,
    « En effet, » opening sentence after sentence. Delete most of them, the order carries the
    logic.

### Style

14. **Colon overuse.** Fine before a list or an example. Not as a mid-sentence hinge or a fake
    reveal (« Le résultat : une app plus rapide. »). Write the sentence.
15. **Boldface overuse.** Don't bold every term. Bold at most what the reader must not miss.
16. **Inline-header lists.** The tell is a bold label and colon that restates the line:
    « **Performance :** la performance s'améliore... ». Convert to prose. A bold lead-in that ends
    in a period, names the item and is followed by new detail is fine.
17. **Title case headings.** Use sentence case.
18. **Decorative emojis.** Remove from headings and bullets.
36. **Over-structuring.** Headers and bullets around three sentences of content. Make it a
    paragraph.

### Communication artifacts

20. **Chatbot phrases.** « Voici », « Bien sûr ! », « N'hésitez pas à », « J'espère que cela vous
    aide », « Vous l'aurez compris », "Let me know if...", "Found the smoking gun!". Remove.
22. **Sycophantic tone.** « Excellente question ! », "You're absolutely right!". Respond directly.

### Filler

23. **Filler phrases.** « afin de » / « dans le but de » become « pour », « du fait que » becomes
    « parce que », « il est important de noter que » and « force est de constater que » get
    deleted. "In order to" becomes "To".
24. **Excessive hedging.** « pourrait potentiellement éventuellement » becomes « peut ». One hedge
    per claim, only when the uncertainty is real.
25. **Generic conclusions.** « En somme », « En définitive », « L'avenir s'annonce prometteur ».
    End on the last fact, decision or next step, or just stop.

### Jargon

26. **Abstract metaphor nouns.** Substrate, vector, paradigm, north star, flywheel, endgame,
    scaffolding (as metaphor), « socle », « brique », « pierre angulaire », « fer de lance »,
    « boussole ». Pick the concrete word: « socle » becomes « base », « brique » becomes
    « composant » or « module ».

### Plain speech

27. **Say what it does, not how it feels.** « une expérience plus fluide » names a feeling. Name
    the mechanism or a number: « la liste se charge en une requête au lieu de douze ». If the
    sentence could appear unchanged in another project's docs, it says nothing about this one.
    Cut it.
28. **Shorten or split dense sentences.** If the reader has to backtrack, split or drop clauses.
    One idea per sentence.
29. **Active voice.** « les requêtes sont validées » becomes « le compilateur valide les
    requêtes ». Passive only when the actor is unknown or irrelevant.
30. **Cut adverbs, or use a stronger verb.** « améliore significativement » becomes the measured
    delta.
31. **Prefer the plain word.** « utiliser » over « exploiter » / « tirer parti de », « aider » over
    « faciliter », « nombreux » over « pléthore de », « si » over « dans l'éventualité où ».
32. **Mannered prose.** Aphorisms, rhetorical fragments for effect, personified code (« le plan le
    porte »), figurative verbs. Say it literally.
33. **Over-compression.** Dropped articles, verbless fragments, arrows and abbreviations the
    reader has to decode. « Date invalide → exit 2, pas d'écriture » becomes « Le parseur rejette
    une date invalide, sort avec le code 2 et n'écrit rien. »

## Example

Before:

> Cette nouvelle fonctionnalité joue un rôle clé dans l'amélioration de l'expérience utilisateur.
> Ce n'est pas seulement un gain de performance — c'est une véritable refonte, permettant ainsi
> une navigation plus fluide et intuitive. En somme, une avancée majeure.

After:

> La liste de conversations se charge maintenant en une requête au lieu de douze.

(If the source has no numbers, do not invent them. Keep the claim plain.)
