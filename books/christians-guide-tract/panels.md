# Shot list: the tract's cartoons

Thirteen panels, one per spread, plus the cover. Source of truth is `panels.yaml`; this file is rendered from it by `tools/panels.py md` and carries the exact prompt and fal request id of every generated image. Style: plain black ink line drawing in the small gospel-tract tradition, warm and plain, ordinary people in an ordinary school and church, no caricature, no real person, no denomination mocked. Lettering inside the pictures is done by the same GPT Image 2 call, spelled from the shot list.

## The cast (consistent across the book)

- THE MINISTER, a man in his late sixties, short white hair, round wire glasses, a cardigan over an open-collared shirt, a kind lined face
- THE TEACHER, a woman in her forties, hair pulled back, a cardigan, a lanyard with a key card, flat shoes
- THE CHILD, a boy about nine, a striped t-shirt, sneakers, a cowlick
- THE BOARD MEMBER, a Black woman in her fifties, a blazer, reading glasses on a cord, short natural hair
- THE SUPERINTENDENT, a heavyset man in his fifties, a tie, a school lanyard, a lapel pin
- THE PRINCIPAL, a man in his forties, a mustache, shirt sleeves and a tie, a ring of keys on his belt

The cast is drawn once on `art/character-sheet.png`, which is attached as a reference image to every panel and to the cover.

## Estimated cost (fal.ai, high quality, prices read 2026-10-29)

| Item | Count | Each | Total |
|---|---|---|---|
| Character sheet, gpt-image-2, 1024x1024 | 1 | $0.211 | $0.21 |
| Panels, gpt-image-2/edit, 1024x1536 | 13 | $0.178 | $2.31 |
| Cover front, gpt-image-2/edit, 1024x1536 | 1 | $0.178 | $0.18 |
| **Total** | | | **$2.70** |

Each redo of a panel adds $0.178. The cover is upscaled with Pillow (free); no other paid call.

## Character sheet

`art/character-sheet.png`, request `01a188a7-612c-76d3-a1e4-ca8c7b6c0e69`, 2026-10-29 10:15:30

## s01: pages 4-5, Why a minister is writing this

**Scene.** A church fellowship hall: folding tables, a coffee urn on a side table, a plain wooden cross on the wall, a stack of paper cups. THE SUPERINTENDENT stands on the LEFT of the picture and THE MINISTER on the RIGHT, facing each other, each holding a paper cup of coffee, both calm and courteous. The Superintendent speaks first, so his balloon is on the left and higher; the Minister's reply balloon is on the right and lower.

**Text.** THE SUPERINTENDENT: “THE BIBLE SAYS WHAT IT SAYS.”; THE MINISTER: “IT DOES. IT ALSO SAYS HOW TO JUDGE WHAT WE DO WITH IT.”

**Cast.** minister, superintendent

**Generated.** `art/s01.png`, model `fal-ai/gpt-image-2/edit`, request `01a188b8-cbe8-7e13-a000-5cc7d438e916`, 2026-10-29 10:34:15, 1024x1536 high quality, references ['art/character-sheet.png'].

<details><summary>Exact prompt</summary>

```
One page of a small black-and-white tract, portrait.

A plain black ink line drawing in the tradition of small gospel tracts: clean, confident pen lines, light cross-hatching for shade, no gray wash, no color, no halftone, pure black on white paper. Modest realism, warm and plain faces, ordinary clothes, ordinary rooms. Nothing is exaggerated: no caricature, no distorted features, no mockery of anyone, no likeness of any real person, no logos, no denominational symbols beyond a plain wooden cross where the scene calls for one. Every text element is hand-lettered in neat upright block capitals in black ink and must be spelled exactly as given. No other text, signs, labels or lettering anywhere in the picture.

The scene: A church fellowship hall: folding tables, a coffee urn on a side table, a plain wooden cross on the wall, a stack of paper cups. THE SUPERINTENDENT stands on the LEFT of the picture and THE MINISTER on the RIGHT, facing each other, each holding a paper cup of coffee, both calm and courteous. The Superintendent speaks first, so his balloon is on the left and higher; the Minister's reply balloon is on the right and lower.

The people, drawn exactly as they appear in the attached character sheet:
- THE MINISTER, a man in his late sixties, short white hair, round wire glasses, a cardigan over an open-collared shirt, a kind lined face
- THE SUPERINTENDENT, a heavyset man in his fifties, a tie, a school lanyard, a lapel pin

Speech balloons, hand-lettered in neat block capitals, spelled exactly:
THE SUPERINTENDENT says, in a plain speech balloon: "THE BIBLE SAYS WHAT IT SAYS."
THE MINISTER says, in a plain speech balloon: "IT DOES. IT ALSO SAYS HOW TO JUDGE WHAT WE DO WITH IT."
```

</details>

## s02: pages 6-7, Teaching them to observe all things

**Scene.** A Sunday school room with a low round table, small chairs, a felt board on an easel and a window with curtains. THE TEACHER sits at the low table with four children, THE CHILD among them, reading from an open book while the children lean in.

**Text.** caption: “A DISCIPLE IS A LEARNER.”

**Cast.** teacher, child

**Generated.** `art/s02.png`, model `fal-ai/gpt-image-2/edit`, request `01a188ba-0ea5-7de3-b2be-6bdfb895c785`, 2026-10-29 10:35:35, 1024x1536 high quality, references ['art/character-sheet.png'].

<details><summary>Exact prompt</summary>

```
One page of a small black-and-white tract, portrait.

A plain black ink line drawing in the tradition of small gospel tracts: clean, confident pen lines, light cross-hatching for shade, no gray wash, no color, no halftone, pure black on white paper. Modest realism, warm and plain faces, ordinary clothes, ordinary rooms. Nothing is exaggerated: no caricature, no distorted features, no mockery of anyone, no likeness of any real person, no logos, no denominational symbols beyond a plain wooden cross where the scene calls for one. Every text element is hand-lettered in neat upright block capitals in black ink and must be spelled exactly as given. No other text, signs, labels or lettering anywhere in the picture.

The scene: A Sunday school room with a low round table, small chairs, a felt board on an easel and a window with curtains. THE TEACHER sits at the low table with four children, THE CHILD among them, reading from an open book while the children lean in.

The people, drawn exactly as they appear in the attached character sheet:
- THE TEACHER, a woman in her forties, hair pulled back, a cardigan, a lanyard with a key card, flat shoes
- THE CHILD, a boy about nine, a striped t-shirt, sneakers, a cowlick

One caption in a plain rectangular box across the foot of the picture, hand-lettered in neat block capitals, spelled exactly: "A DISCIPLE IS A LEARNER."
```

</details>

## s03: pages 8-9, Provoke not your children to wrath

**Scene.** A school hallway with lockers. THE CHILD sits alone on a bench outside a closed office door, arms crossed, jaw set, angry and near tears. THE TEACHER stands a few steps away in a classroom doorway, one hand on the door frame, looking at him with concern.

**Text.** caption: “DO NOT PROVOKE THE CHILD TO WRATH. THEN RAISE AND TEACH.”

**Cast.** child, teacher

**Generated.** `art/s03.png`, model `fal-ai/gpt-image-2/edit`, request `01a188ba-0f18-73c0-bf94-85e823e58f63`, 2026-10-29 10:35:36, 1024x1536 high quality, references ['art/character-sheet.png'].

<details><summary>Exact prompt</summary>

```
One page of a small black-and-white tract, portrait.

A plain black ink line drawing in the tradition of small gospel tracts: clean, confident pen lines, light cross-hatching for shade, no gray wash, no color, no halftone, pure black on white paper. Modest realism, warm and plain faces, ordinary clothes, ordinary rooms. Nothing is exaggerated: no caricature, no distorted features, no mockery of anyone, no likeness of any real person, no logos, no denominational symbols beyond a plain wooden cross where the scene calls for one. Every text element is hand-lettered in neat upright block capitals in black ink and must be spelled exactly as given. No other text, signs, labels or lettering anywhere in the picture.

The scene: A school hallway with lockers. THE CHILD sits alone on a bench outside a closed office door, arms crossed, jaw set, angry and near tears. THE TEACHER stands a few steps away in a classroom doorway, one hand on the door frame, looking at him with concern.

The people, drawn exactly as they appear in the attached character sheet:
- THE CHILD, a boy about nine, a striped t-shirt, sneakers, a cowlick
- THE TEACHER, a woman in her forties, hair pulled back, a cardigan, a lanyard with a key card, flat shoes

One caption in a plain rectangular box across the foot of the picture, hand-lettered in neat block capitals, spelled exactly: "DO NOT PROVOKE THE CHILD TO WRATH. THEN RAISE AND TEACH."
```

</details>

## s04: pages 10-11, Afterward it yieldeth the peaceable fruit of righteousness

**Scene.** An orchard in late summer. THE MINISTER stands with one hand on the trunk of an apple tree heavy with fruit; THE CHILD beside him holds an apple up to show him. Rows of trees recede behind them.

**Text.** caption: “JUDGE IT BY WHAT IT YIELDS AFTERWARD.”

**Cast.** minister, child

**Generated.** `art/s04.png`, model `fal-ai/gpt-image-2/edit`, request `01a188ba-0e3e-76f3-9023-5528bf1fdb84`, 2026-10-29 10:35:44, 1024x1536 high quality, references ['art/character-sheet.png'].

<details><summary>Exact prompt</summary>

```
One page of a small black-and-white tract, portrait.

A plain black ink line drawing in the tradition of small gospel tracts: clean, confident pen lines, light cross-hatching for shade, no gray wash, no color, no halftone, pure black on white paper. Modest realism, warm and plain faces, ordinary clothes, ordinary rooms. Nothing is exaggerated: no caricature, no distorted features, no mockery of anyone, no likeness of any real person, no logos, no denominational symbols beyond a plain wooden cross where the scene calls for one. Every text element is hand-lettered in neat upright block capitals in black ink and must be spelled exactly as given. No other text, signs, labels or lettering anywhere in the picture.

The scene: An orchard in late summer. THE MINISTER stands with one hand on the trunk of an apple tree heavy with fruit; THE CHILD beside him holds an apple up to show him. Rows of trees recede behind them.

The people, drawn exactly as they appear in the attached character sheet:
- THE MINISTER, a man in his late sixties, short white hair, round wire glasses, a cardigan over an open-collared shirt, a kind lined face
- THE CHILD, a boy about nine, a striped t-shirt, sneakers, a cowlick

One caption in a plain rectangular box across the foot of the picture, hand-lettered in neat block capitals, spelled exactly: "JUDGE IT BY WHAT IT YIELDS AFTERWARD."
```

</details>

## s05: pages 12-13, He that spareth his rod hateth his son

**Scene.** A kitchen table. THE MINISTER, reading glasses on, has a large open Bible in front of him and a finger on the page. THE BOARD MEMBER sits across from him with a cup of coffee, listening, her glasses in her hand.

**Text.** THE MINISTER: “I AM QUOTING ALL OF THEM. I DO NOT WANT TO BE ACCUSED OF HIDING ONE.”

**Cast.** minister, board_member

**Generated.** `art/s05.png`, model `fal-ai/gpt-image-2/edit`, request `01a188ba-0e67-7563-8ec1-e278e6df5dd3`, 2026-10-29 10:35:35, 1024x1536 high quality, references ['art/character-sheet.png'].

<details><summary>Exact prompt</summary>

```
One page of a small black-and-white tract, portrait.

A plain black ink line drawing in the tradition of small gospel tracts: clean, confident pen lines, light cross-hatching for shade, no gray wash, no color, no halftone, pure black on white paper. Modest realism, warm and plain faces, ordinary clothes, ordinary rooms. Nothing is exaggerated: no caricature, no distorted features, no mockery of anyone, no likeness of any real person, no logos, no denominational symbols beyond a plain wooden cross where the scene calls for one. Every text element is hand-lettered in neat upright block capitals in black ink and must be spelled exactly as given. No other text, signs, labels or lettering anywhere in the picture.

The scene: A kitchen table. THE MINISTER, reading glasses on, has a large open Bible in front of him and a finger on the page. THE BOARD MEMBER sits across from him with a cup of coffee, listening, her glasses in her hand.

The people, drawn exactly as they appear in the attached character sheet:
- THE MINISTER, a man in his late sixties, short white hair, round wire glasses, a cardigan over an open-collared shirt, a kind lined face
- THE BOARD MEMBER, a Black woman in her fifties, a blazer, reading glasses on a cord, short natural hair

Speech balloons, hand-lettered in neat block capitals, spelled exactly:
THE MINISTER says, in a plain speech balloon: "I AM QUOTING ALL OF THEM. I DO NOT WANT TO BE ACCUSED OF HIDING ONE."
```

</details>

## s06: pages 14-15, His son. Thy son.

**Scene.** A principal's office. THE PRINCIPAL sits behind his desk with his hands folded; a flat wooden paddle hangs on the wall behind him and a signed form lies on the desk. THE CHILD sits very small in the chair in front of the desk, feet not reaching the floor, hands in his lap. No one is touching anyone; the room is still.

**Text.** caption: “NOT ONE OF THOSE VERSES IS ADDRESSED TO A SCHOOL.”

**Cast.** principal, child

**Generated.** `art/s06.png`, model `fal-ai/gpt-image-2/edit`, request `01a188bb-4182-7df1-a314-75589713e9f7`, 2026-10-29 10:36:52, 1024x1536 high quality, references ['art/character-sheet.png'].

<details><summary>Exact prompt</summary>

```
One page of a small black-and-white tract, portrait.

A plain black ink line drawing in the tradition of small gospel tracts: clean, confident pen lines, light cross-hatching for shade, no gray wash, no color, no halftone, pure black on white paper. Modest realism, warm and plain faces, ordinary clothes, ordinary rooms. Nothing is exaggerated: no caricature, no distorted features, no mockery of anyone, no likeness of any real person, no logos, no denominational symbols beyond a plain wooden cross where the scene calls for one. Every text element is hand-lettered in neat upright block capitals in black ink and must be spelled exactly as given. No other text, signs, labels or lettering anywhere in the picture.

The scene: A principal's office. THE PRINCIPAL sits behind his desk with his hands folded; a flat wooden paddle hangs on the wall behind him and a signed form lies on the desk. THE CHILD sits very small in the chair in front of the desk, feet not reaching the floor, hands in his lap. No one is touching anyone; the room is still.

The people, drawn exactly as they appear in the attached character sheet:
- THE PRINCIPAL, a man in his forties, a mustache, shirt sleeves and a tie, a ring of keys on his belt
- THE CHILD, a boy about nine, a striped t-shirt, sneakers, a cowlick

One caption in a plain rectangular box across the foot of the picture, hand-lettered in neat block capitals, spelled exactly: "NOT ONE OF THOSE VERSES IS ADDRESSED TO A SCHOOL."
```

</details>

## s07: pages 16-17, Ye shall know them by their fruits

**Scene.** A path between rows of fruit trees. THE MINISTER and THE BOARD MEMBER walk side by side. The tree nearest them is a bare thorn bush with no fruit; every tree beyond it is heavy with apples.

**Text.** THE BOARD MEMBER: “I WAS PADDLED AND I TURNED OUT FINE.”; THE MINISTER: “THAT IS WHAT ONE TREE PROVES ABOUT AN ORCHARD.”

**Cast.** minister, board_member

**Generated.** `art/s07.png`, model `fal-ai/gpt-image-2/edit`, request `01a188bb-41a5-7573-8aa4-2cb07200ee58`, 2026-10-29 10:37:01, 1024x1536 high quality, references ['art/character-sheet.png'].

<details><summary>Exact prompt</summary>

```
One page of a small black-and-white tract, portrait.

A plain black ink line drawing in the tradition of small gospel tracts: clean, confident pen lines, light cross-hatching for shade, no gray wash, no color, no halftone, pure black on white paper. Modest realism, warm and plain faces, ordinary clothes, ordinary rooms. Nothing is exaggerated: no caricature, no distorted features, no mockery of anyone, no likeness of any real person, no logos, no denominational symbols beyond a plain wooden cross where the scene calls for one. Every text element is hand-lettered in neat upright block capitals in black ink and must be spelled exactly as given. No other text, signs, labels or lettering anywhere in the picture.

The scene: A path between rows of fruit trees. THE MINISTER and THE BOARD MEMBER walk side by side. The tree nearest them is a bare thorn bush with no fruit; every tree beyond it is heavy with apples.

The people, drawn exactly as they appear in the attached character sheet:
- THE MINISTER, a man in his late sixties, short white hair, round wire glasses, a cardigan over an open-collared shirt, a kind lined face
- THE BOARD MEMBER, a Black woman in her fifties, a blazer, reading glasses on a cord, short natural hair

Speech balloons, hand-lettered in neat block capitals, spelled exactly:
THE BOARD MEMBER says, in a plain speech balloon: "I WAS PADDLED AND I TURNED OUT FINE."
THE MINISTER says, in a plain speech balloon: "THAT IS WHAT ONE TREE PROVES ABOUT AN ORCHARD."
```

</details>

## s08: pages 18-19, The thing we tell ourselves paddling is for

**Scene.** A classroom with rows of desks and children writing. THE CHILD has his head down on his folded arms on his desk. THE TEACHER crouches beside his desk with a hand on his shoulder, speaking quietly.

**Text.** caption: “THE ANXIETY AND WITHDRAWAL THAT TEACHERS CALL QUIET.”

**Cast.** child, teacher

**Generated.** `art/s08.png`, model `fal-ai/gpt-image-2/edit`, request `01a188bb-4532-7180-9450-3b41a8eae10c`, 2026-10-29 10:36:53, 1024x1536 high quality, references ['art/character-sheet.png'].

<details><summary>Exact prompt</summary>

```
One page of a small black-and-white tract, portrait.

A plain black ink line drawing in the tradition of small gospel tracts: clean, confident pen lines, light cross-hatching for shade, no gray wash, no color, no halftone, pure black on white paper. Modest realism, warm and plain faces, ordinary clothes, ordinary rooms. Nothing is exaggerated: no caricature, no distorted features, no mockery of anyone, no likeness of any real person, no logos, no denominational symbols beyond a plain wooden cross where the scene calls for one. Every text element is hand-lettered in neat upright block capitals in black ink and must be spelled exactly as given. No other text, signs, labels or lettering anywhere in the picture.

The scene: A classroom with rows of desks and children writing. THE CHILD has his head down on his folded arms on his desk. THE TEACHER crouches beside his desk with a hand on his shoulder, speaking quietly.

The people, drawn exactly as they appear in the attached character sheet:
- THE CHILD, a boy about nine, a striped t-shirt, sneakers, a cowlick
- THE TEACHER, a woman in her forties, hair pulled back, a cardigan, a lanyard with a key card, flat shoes

One caption in a plain rectangular box across the foot of the picture, hand-lettered in neat block capitals, spelled exactly: "THE ANXIETY AND WITHDRAWAL THAT TEACHERS CALL QUIET."
```

</details>

## s09: pages 20-21, Lest they be discouraged

**Scene.** A front porch step in plain daylight, a screen door behind, the sky left as blank white paper. A grown man in his thirties in a work shirt, with the same cowlick THE CHILD has, sits on the step looking down at his own hands. His small daughter, about five, sits beside him looking up at his face. Light, open line work with white paper showing everywhere; no dark sky, no heavy shading, no gray tone.

**Text.** caption: “WHATSOEVER A MAN SOWETH, THAT SHALL HE ALSO REAP.”

**Cast.** none of the recurring cast

**Generated.** `art/s09.png`, model `fal-ai/gpt-image-2/edit`, request `01a188bd-f44b-72c1-92fd-6d930c598708`, 2026-10-29 10:39:57, 1024x1536 high quality, references ['art/character-sheet.png'].

<details><summary>Exact prompt</summary>

```
One page of a small black-and-white tract, portrait.

A plain black ink line drawing in the tradition of small gospel tracts: clean, confident pen lines, light cross-hatching for shade, no gray wash, no color, no halftone, pure black on white paper. Modest realism, warm and plain faces, ordinary clothes, ordinary rooms. Nothing is exaggerated: no caricature, no distorted features, no mockery of anyone, no likeness of any real person, no logos, no denominational symbols beyond a plain wooden cross where the scene calls for one. Every text element is hand-lettered in neat upright block capitals in black ink and must be spelled exactly as given. No other text, signs, labels or lettering anywhere in the picture.

The scene: A front porch step in plain daylight, a screen door behind, the sky left as blank white paper. A grown man in his thirties in a work shirt, with the same cowlick THE CHILD has, sits on the step looking down at his own hands. His small daughter, about five, sits beside him looking up at his face. Light, open line work with white paper showing everywhere; no dark sky, no heavy shading, no gray tone.

No recurring characters appear; the two people are described in the scene.

One caption in a plain rectangular box across the foot of the picture, hand-lettered in neat block capitals, spelled exactly: "WHATSOEVER A MAN SOWETH, THAT SHALL HE ALSO REAP."
```

</details>

## s10: pages 22-23, Prove all things; hold fast that which is good

**Scene.** A kitchen table at night under a single lamp. THE BOARD MEMBER, reading glasses on, holds a stapled research paper in one hand and reads it closely; an open Bible lies on the table beside it with a pencil across the page.

**Text.** caption: “PROVE, IN THE OLD SENSE: TEST.”

**Cast.** board_member

**Generated.** `art/s10.png`, model `fal-ai/gpt-image-2/edit`, request `01a188bc-712d-7ce3-966e-a0c2e3c62954`, 2026-10-29 10:38:09, 1024x1536 high quality, references ['art/character-sheet.png'].

<details><summary>Exact prompt</summary>

```
One page of a small black-and-white tract, portrait.

A plain black ink line drawing in the tradition of small gospel tracts: clean, confident pen lines, light cross-hatching for shade, no gray wash, no color, no halftone, pure black on white paper. Modest realism, warm and plain faces, ordinary clothes, ordinary rooms. Nothing is exaggerated: no caricature, no distorted features, no mockery of anyone, no likeness of any real person, no logos, no denominational symbols beyond a plain wooden cross where the scene calls for one. Every text element is hand-lettered in neat upright block capitals in black ink and must be spelled exactly as given. No other text, signs, labels or lettering anywhere in the picture.

The scene: A kitchen table at night under a single lamp. THE BOARD MEMBER, reading glasses on, holds a stapled research paper in one hand and reads it closely; an open Bible lies on the table beside it with a pencil across the page.

The people, drawn exactly as they appear in the attached character sheet:
- THE BOARD MEMBER, a Black woman in her fifties, a blazer, reading glasses on a cord, short natural hair

One caption in a plain rectangular box across the foot of the picture, hand-lettered in neat block capitals, spelled exactly: "PROVE, IN THE OLD SENSE: TEST."
```

</details>

## s11: pages 24-25, Chasteneth him betimes

**Scene.** A classroom. THE TEACHER kneels beside THE CHILD at his desk and points to a poster on the wall showing three simple rules as pictures (a raised hand, a chair, a clock) with no words on it. THE CHILD is practicing raising his hand, a little smile on his face.

**Text.** caption: “EARLY, OFTEN, AND BEFORE THE THING HAS GONE WRONG.”

**Cast.** teacher, child

**Generated.** `art/s11.png`, model `fal-ai/gpt-image-2/edit`, request `01a188bc-7432-7292-8ceb-a026ed1dc67c`, 2026-10-29 10:38:07, 1024x1536 high quality, references ['art/character-sheet.png'].

<details><summary>Exact prompt</summary>

```
One page of a small black-and-white tract, portrait.

A plain black ink line drawing in the tradition of small gospel tracts: clean, confident pen lines, light cross-hatching for shade, no gray wash, no color, no halftone, pure black on white paper. Modest realism, warm and plain faces, ordinary clothes, ordinary rooms. Nothing is exaggerated: no caricature, no distorted features, no mockery of anyone, no likeness of any real person, no logos, no denominational symbols beyond a plain wooden cross where the scene calls for one. Every text element is hand-lettered in neat upright block capitals in black ink and must be spelled exactly as given. No other text, signs, labels or lettering anywhere in the picture.

The scene: A classroom. THE TEACHER kneels beside THE CHILD at his desk and points to a poster on the wall showing three simple rules as pictures (a raised hand, a chair, a clock) with no words on it. THE CHILD is practicing raising his hand, a little smile on his face.

The people, drawn exactly as they appear in the attached character sheet:
- THE TEACHER, a woman in her forties, hair pulled back, a cardigan, a lanyard with a key card, flat shoes
- THE CHILD, a boy about nine, a striped t-shirt, sneakers, a cowlick

One caption in a plain rectangular box across the foot of the picture, hand-lettered in neat block capitals, spelled exactly: "EARLY, OFTEN, AND BEFORE THE THING HAS GONE WRONG."
```

</details>

## s12: pages 26-27, Same scripture. Different board.

**Scene.** A large church assembly hall seen from the back: rows of seated delegates of all ages holding up white voting cards, a moderator at a lectern on a low stage, a plain banner with no words behind the stage. Orderly, serious, open.

**Text.** caption: “THREE HUNDRED THIRTY-FOUR TO THREE HUNDRED SIX.”

**Cast.** none of the recurring cast

**Generated.** `art/s12.png`, model `fal-ai/gpt-image-2/edit`, request `01a188bc-9121-7350-86a5-ec6eec6f20e0`, 2026-10-29 10:38:24, 1024x1536 high quality, references ['art/character-sheet.png'].

<details><summary>Exact prompt</summary>

```
One page of a small black-and-white tract, portrait.

A plain black ink line drawing in the tradition of small gospel tracts: clean, confident pen lines, light cross-hatching for shade, no gray wash, no color, no halftone, pure black on white paper. Modest realism, warm and plain faces, ordinary clothes, ordinary rooms. Nothing is exaggerated: no caricature, no distorted features, no mockery of anyone, no likeness of any real person, no logos, no denominational symbols beyond a plain wooden cross where the scene calls for one. Every text element is hand-lettered in neat upright block capitals in black ink and must be spelled exactly as given. No other text, signs, labels or lettering anywhere in the picture.

The scene: A large church assembly hall seen from the back: rows of seated delegates of all ages holding up white voting cards, a moderator at a lectern on a low stage, a plain banner with no words behind the stage. Orderly, serious, open.

No recurring characters appear; the two people are described in the scene.

One caption in a plain rectangular box across the foot of the picture, hand-lettered in neat block capitals, spelled exactly: "THREE HUNDRED THIRTY-FOUR TO THREE HUNDRED SIX."
```

</details>

## s13: pages 28-29, The Board prohibits the use of corporal punishment in the District.

**Scene.** A school board meeting room. A long table with microphones and nameplates (blank). THE BOARD MEMBER, seated at the table, raises her hand to vote, a single index card in front of her. THE SUPERINTENDENT sits at the end of the table. In the audience chairs behind, THE MINISTER and THE TEACHER sit watching.

**Text.** caption: “MOVE THE SENTENCE.”

**Cast.** board_member, superintendent, minister, teacher

**Generated.** `art/s13.png`, model `fal-ai/gpt-image-2/edit`, request `01a188bc-a9c4-79c0-be97-2a988672eee3`, 2026-10-29 10:38:22, 1024x1536 high quality, references ['art/character-sheet.png'].

<details><summary>Exact prompt</summary>

```
One page of a small black-and-white tract, portrait.

A plain black ink line drawing in the tradition of small gospel tracts: clean, confident pen lines, light cross-hatching for shade, no gray wash, no color, no halftone, pure black on white paper. Modest realism, warm and plain faces, ordinary clothes, ordinary rooms. Nothing is exaggerated: no caricature, no distorted features, no mockery of anyone, no likeness of any real person, no logos, no denominational symbols beyond a plain wooden cross where the scene calls for one. Every text element is hand-lettered in neat upright block capitals in black ink and must be spelled exactly as given. No other text, signs, labels or lettering anywhere in the picture.

The scene: A school board meeting room. A long table with microphones and nameplates (blank). THE BOARD MEMBER, seated at the table, raises her hand to vote, a single index card in front of her. THE SUPERINTENDENT sits at the end of the table. In the audience chairs behind, THE MINISTER and THE TEACHER sit watching.

The people, drawn exactly as they appear in the attached character sheet:
- THE BOARD MEMBER, a Black woman in her fifties, a blazer, reading glasses on a cord, short natural hair
- THE SUPERINTENDENT, a heavyset man in his fifties, a tie, a school lanyard, a lapel pin
- THE MINISTER, a man in his late sixties, short white hair, round wire glasses, a cardigan over an open-collared shirt, a kind lined face
- THE TEACHER, a woman in her forties, hair pulled back, a cardigan, a lanyard with a key card, flat shoes

One caption in a plain rectangular box across the foot of the picture, hand-lettered in neat block capitals, spelled exactly: "MOVE THE SENTENCE."
```

</details>

## Cover

**Scene.** A front cover for a small tract, portrait. An apple tree heavy with fruit fills the middle of the picture. THE MINISTER sits on a plain bench beneath it with an open Bible on his knee; THE CHILD stands on tiptoe reaching up for an apple. Generous white space at the top for the title and at the bottom for the author's name.

**Lettering.** A SAFE SCHOOLS GUIDE / A CHRISTIAN'S GUIDE TO CORPORAL PUNISHMENT / The rod, the fruit, and the school board / ANTHONY ADAMS

**Generated.** `build/cover/front-art.png`, request `01a188ba-82a6-7f23-b163-79706f979e82`, 2026-10-29 10:36:11.

<details><summary>Exact prompt</summary>

```
The front cover of a small tract, portrait.

The same plain pen-and-ink line drawing as the attached black-and-white cover, reproduced exactly in composition, figures and lettering, and hand-colored with soft flat watercolor washes in the way old tracts and Sunday school papers were: a warm cream background, fresh green leaves, bright red apples, warm brown bark and bench, the Minister's tan cardigan and pale blue shirt, the Child's blue-and-white striped shirt and tan trousers, warm skin tones. Black ink lines stay crisp over the color. The lettering is deep red for the title and dark green for the other lines, hand-lettered in bold upright block capitals. No gradients, no photographic shading, no other text anywhere.

The scene: A front cover for a small tract, portrait. An apple tree heavy with fruit fills the middle of the picture. THE MINISTER sits on a plain bench beneath it with an open Bible on his knee; THE CHILD stands on tiptoe reaching up for an apple. Generous white space at the top for the title and at the bottom for the author's name.

The people, drawn exactly as they appear in the attached character sheet:
- THE MINISTER, a man in his late sixties, short white hair, round wire glasses, a cardigan over an open-collared shirt, a kind lined face
- THE CHILD, a boy about nine, a striped t-shirt, sneakers, a cowlick

Lettering, hand-drawn in bold upright block capitals, black, spelled exactly: a small line at the very top "A SAFE SCHOOLS GUIDE"; beneath it the title in large letters "A CHRISTIAN'S GUIDE TO CORPORAL PUNISHMENT"; beneath the title in smaller mixed-case letters "The rod, the fruit, and the school board"; at the bottom the author "ANTHONY ADAMS". All text perfectly spelled, sharp and legible, nothing else written anywhere.
```

</details>
