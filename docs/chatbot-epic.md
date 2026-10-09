# Knowledge base chatbot epic (E9), backlog rows

Status: **rough draft. Not a spec, nothing decided.** Each story still goes through Plan (grilling, then /to-spec).
Sprint 3: 2 weeks (12–23 Oct 2026), 2 people. 8 stories, 32 points, 16 each. 3 more stories for a later sprint.
Columns match the VETTED tab: ID (domain), Epic, Title, Role, Goal, Reason / Benefit, Acceptance Criteria, Priority, Story Points, Dependencies, Sprint.
To paste the ACs into one cell: double-click the cell first, then paste. Otherwise Sheets splits the lines into rows.

## Replaces the old E9 rows
| Old VETTED row | Now |
|---|---|
| CB-01 Ask a knowledge question with a cited answer | CB-01 |
| CB-02 Inspect the passage behind a chat citation | CB-02 |
| CB-03 Ask follow-up questions in a conversation | Merged into CB-01 (AC3, AC4) |
| CB-04 Collect feedback on chatbot answers | Removed |
| CB-05 Audit the evidence behind chatbot responses | Removed (EV-03 logs every AI call; CB-03 stores each exchange) |
| CB-06 CRUD for personal chatbot conversations | CB-03 |

## Points, compared with accepted Sprint 1–2 stories
| ID | Pts | Benchmark |
|---|---|---|
| CB-01 | 5 | GN-05: reuses GN-01's search and citation checks, adds a new flow. GN-01 (8) built them. |
| CB-02 | 3 | CP-03: one new viewer. The original PDF is served by ID (IN-01 AC4) and passages store page and position. |
| CB-03 | 3 | RV-10: list, search, rename, delete. |
| CB-04 | 3 | IN-09: one data change (messages stored as a tree), one control. |
| CB-05 | 5 | IN-05: an AI step that decides what to keep, plus a screen to manage it. |
| CB-06 | 5 | EV-01: test runs saved and compared. |
| CB-07 | 5 | GN-05: brings the assessment into answers, and accepted text goes into the report. |
| CB-08 | 3 | F-06: one request flow across two roles. Reuses IN-10 notifications. |
| CB-09 | 2 | CP-02: one new step (photo → vision description) in front of CB-01. |
| CB-10 | 3 | IN-02: reuses text extraction, adds a store only that conversation can search. |
| CB-11 | 2 | IN-06: reuses CP-03 transcription; reading aloud uses the browser's built-in speech. |

---

## Sprint 3

### CB-01 (AI and Machine Learning)
- **Epic:** E9 Knowledge Base Chatbot
- **Title:** Ask questions with cited answers
- **Role:** risk engineer
- **Goal:** I want to ask questions about standards and past reports in a conversation
- **Reason / Benefit:** so that I get sourced answers without reading through the documents myself.
- **Priority:** Must
- **Story Points:** 5
- **Dependencies:** GN-01
- **Sprint:** 3
```
1) Given I ask a question the knowledge base covers, When the answer is shown, Then each statement cites the passage it came from.
2) Given no passage supports an answer, When the answer is shown, Then it says the knowledge base cannot answer, And it cites nothing.
3) Given I asked about a topic earlier in the conversation, When I ask a follow-up that refers back to it, Then the answer is about that topic.
4) Given a follow-up could refer to more than one earlier topic, When I send it, Then the chatbot asks which one I mean.
5) Given my question names a country, facility type or source type, When the answer is shown, Then every citation comes from documents that match it.
6) Given I send a question, When the answer is being written, Then it appears as it is written, not all at once at the end.
```

### CB-02 (Software Engineering)
- **Epic:** E9 Knowledge Base Chatbot
- **Title:** Check a citation against its source
- **Role:** risk engineer
- **Goal:** I want to open the page a citation points to, with the passage highlighted
- **Reason / Benefit:** so that I can check an answer before I rely on it.
- **Priority:** Must
- **Story Points:** 3
- **Dependencies:** CB-01
- **Sprint:** 3
```
1) Given an answer cites a passage, When I open the citation, Then the source page opens beside the conversation with the passage highlighted.
2) Given a source page is open, When I view it, Then the document's title, edition and page number are shown.
3) Given the cited document has a newer edition in the knowledge base, When I open the citation, Then a warning names the newer edition.
```

### CB-03 (Software Engineering)
- **Epic:** E9 Knowledge Base Chatbot
- **Title:** Find my past conversations
- **Role:** risk engineer
- **Goal:** I want my conversations saved where I can find them again
- **Reason / Benefit:** so that I can pick up earlier research instead of asking everything again.
- **Priority:** Should
- **Story Points:** 3
- **Dependencies:** CB-01
- **Sprint:** 3
```
1) Given I ask a question, When the answer is shown, Then the conversation is saved under a name taken from my first question.
2) Given I have saved conversations, When I open my conversation list, Then pinned conversations are listed first, then the rest newest first.
3) Given I search my conversations, When results are shown, Then they include every conversation whose questions or answers contain my words.
4) Given I rename a conversation, When I view my list, Then it shows the new name.
5) Given I delete a conversation and confirm, When I view my list, Then it is no longer listed.
6) Given I open a saved conversation, When I ask another question, Then the answer uses that conversation's earlier exchanges.
7) Given a conversation belongs to another user, When I try to open it, Then access is denied.
```

### CB-04 (Software Engineering)
- **Epic:** E9 Knowledge Base Chatbot
- **Title:** Retry an answer or branch a conversation
- **Role:** risk engineer
- **Goal:** I want to get a fresh answer, or branch off from one of my earlier questions
- **Reason / Benefit:** so that I can try another angle without losing what I had.
- **Priority:** Could
- **Story Points:** 3
- **Dependencies:** CB-03
- **Sprint:** 3
```
1) Given an answer is shown, When I ask for a new answer, Then the new answer is shown, And I can switch back to the earlier one.
2) Given I branch from one of my questions, When the branch opens, Then it holds the conversation up to that question, And the original conversation is unchanged.
3) Given I branch from a question, When I change its wording before sending, Then the branch answers the new wording.
4) Given I am in a branch or on an earlier answer, When I ask a follow-up, Then it uses only the exchanges shown on screen.
```

### CB-05 (AI and Machine Learning)
- **Epic:** E9 Knowledge Base Chatbot
- **Title:** Let the chatbot remember me
- **Role:** risk engineer
- **Goal:** I want the chatbot to remember lasting facts about my work and recall my past conversations
- **Reason / Benefit:** so that I don't have to repeat myself in every conversation.
- **Priority:** Should
- **Story Points:** 5
- **Dependencies:** CB-03
- **Sprint:** 3
```
1) Given I state a lasting fact about my work (e.g. "I mostly survey Singapore offices"), When the answer is shown, Then the fact is saved to my memory without my confirming it.
2) Given a fact is in my memory, When I start a new conversation, Then its answers take that fact into account.
3) Given I ask about something from a past conversation (e.g. "what did we find on that mall's sprinklers?"), When the answer is shown, Then it uses that conversation, And it links to it.
4) Given the chatbot has remembered facts, When I open my memory, Then each fact is listed with the conversation it came from.
5) Given I delete a remembered fact, When I next ask a question, Then that fact is no longer used.
6) Given I turn memory off, When I chat, Then nothing new is remembered, And nothing remembered is used.
```

### CB-06 (AI and Machine Learning)
- **Epic:** E9 Knowledge Base Chatbot
- **Title:** Score chatbot answers after a prompt change
- **Role:** developer
- **Goal:** I want every prompt change scored against the same test questions
- **Reason / Benefit:** so that we can show whether a change made answers better or worse.
- **Priority:** Must
- **Story Points:** 5
- **Dependencies:** CB-01
- **Sprint:** 3
```
1) Given test questions each paired with the passage that answers it, When the evaluation runs, Then it reports the share of questions whose passage was retrieved.
2) Given the same test questions, When the evaluation runs, Then a judge model marks each statement in each answer as supported or unsupported by its citations.
3) Given the judge's marks, When the evaluation finishes, Then the share of supported statements meets the agreed threshold.
4) Given test questions the knowledge base cannot answer, When the evaluation runs, Then it reports the share the chatbot declines.
5) Given test conversations with follow-up questions, When the evaluation runs, Then it reports the share of follow-ups answered on the right topic.
6) Given two saved runs with different prompt versions, When I compare them, Then the change in each score is shown with the questions whose result changed.
```

### CB-07 (AI and Machine Learning)
- **Epic:** E9 Knowledge Base Chatbot
- **Title:** Ask about the report I'm working on
- **Role:** risk engineer
- **Goal:** I want to ask the chatbot questions from the report I'm working on
- **Reason / Benefit:** so that its answers fit my site and observations without me explaining them.
- **Priority:** Should
- **Story Points:** 5
- **Dependencies:** CB-01, GN-01
- **Sprint:** 3
```
1) Given I am working on a report section, When I ask a question in its chat panel, Then the answer takes the assessment's country, facility type and that section's observations into account.
2) Given an answer draws on an observation, When it is shown, Then it cites that observation alongside any passages.
3) Given I chatted on an assessment before, When I reopen its chat panel, Then that conversation is still there.
4) Given an answer is shown in the panel, When I insert it into the section, Then it appears in the draft with working citations.
```

### CB-08 (Software Engineering)
- **Epic:** E9 Knowledge Base Chatbot
- **Title:** Ask an admin to fill a knowledge gap
- **Role:** risk engineer
- **Goal:** I want to flag a question the chatbot couldn't answer to the knowledge admin
- **Reason / Benefit:** so that the missing document gets added to the knowledge base.
- **Priority:** Could
- **Story Points:** 3
- **Dependencies:** CB-01, IN-10
- **Sprint:** 3
```
1) Given the chatbot said it cannot answer, When I send a knowledge gap request, Then the request is saved with my question and a link to the conversation.
2) Given a knowledge gap request is sent, When the knowledge admin checks notifications, Then the new request is shown.
3) Given open requests exist, When the knowledge admin opens knowledge gaps, Then each request shows the question, who asked it and when.
4) Given a request is open, When the knowledge admin marks it filled with a document or dismisses it with a reason, Then the person who asked is notified of the outcome.
```

---

## Later sprint

### CB-09 (AI and Machine Learning)
- **Epic:** E9 Knowledge Base Chatbot
- **Title:** Ask about a photo
- **Role:** risk engineer
- **Goal:** I want to ask a question about a photo I take or upload
- **Reason / Benefit:** so that I can check what the standards say about something I see on site.
- **Priority:** Could
- **Story Points:** 2
- **Dependencies:** CB-01, CP-04
- **Sprint:** TBD
```
1) Given I attach a photo to my question, When the answer is shown, Then it addresses what the photo shows, And it cites the passages it used.
2) Given the photo is too unclear to read, When the answer is shown, Then it says what it could not make out.
3) Given I sent a photo, When I reopen the conversation, Then the photo is shown with my question.
```

### CB-10 (Data Engineering)
- **Epic:** E9 Knowledge Base Chatbot
- **Title:** Ask about a document I attach
- **Role:** risk engineer
- **Goal:** I want to attach a PDF to a conversation and ask about it
- **Reason / Benefit:** so that I can check a client's document against the standards without adding it to the knowledge base.
- **Priority:** Could
- **Story Points:** 3
- **Dependencies:** CB-01, CB-03, IN-02
- **Sprint:** TBD
```
1) Given I attach a PDF to a conversation, When I ask about it, Then the answer cites the pages of that PDF it used.
2) Given I attached a PDF, When I ask a question, Then the answer can cite both the PDF and the knowledge base.
3) Given a PDF is attached to one conversation, When any other conversation or knowledge base search runs, Then none of its passages are returned.
4) Given I delete a conversation, When it is removed, Then its attached PDFs and their passages are removed too.
```

### CB-11 (Software Engineering)
- **Epic:** E9 Knowledge Base Chatbot
- **Title:** Ask by voice and hear the answer
- **Role:** risk engineer
- **Goal:** I want to speak my question and hear the answer read aloud
- **Reason / Benefit:** so that I can use the chatbot on site when my hands are busy.
- **Priority:** Could
- **Story Points:** 2
- **Dependencies:** CB-01, CP-03
- **Sprint:** TBD
```
1) Given I record a question, When I stop recording, Then its transcript appears in the message box for me to check before sending.
2) Given an answer is shown, When I play it, Then it is read aloud without its citation markers.
3) Given microphone permission is denied, When I try to record, Then a message explains how to allow it.
```

---

## Split for Sprint 3 (16 points each)
| Person A: answers and evidence | Pts | Person B: conversations and context | Pts |
|---|---|---|---|
| CB-01 Ask questions with cited answers | 5 | CB-03 Find my past conversations | 3 |
| CB-06 Score chatbot answers after a prompt change | 5 | CB-04 Retry an answer or branch a conversation | 3 |
| CB-02 Check a citation against its source | 3 | CB-05 Let the chatbot remember me | 5 |
| CB-08 Ask an admin to fill a knowledge gap | 3 | CB-07 Ask about the report I'm working on | 5 |
| **Total** | **16** | **Total** | **16** |

Each person gets two AI and Machine Learning stories and two Software Engineering stories.

### How we work: one shared branch, a skeleton first, placeholders for the rest
No meeting needed. The agreements live in code that the first person merges.

**1. Branches**
- `feature/chatbot` branches off `main`. Each story gets its own branch off `feature/chatbot`, and a PR back into it. CI runs on these PRs too (the workflow runs on every push and PR, whatever the target branch).
- Merge `main` into `feature/chatbot` about twice a week, so other teammates' changes surface as small conflicts early, not one big one at the end.
- Sprint end: one PR `feature/chatbot` → `main` through the merge queue. Each story was already reviewed in its own PR.

**2. Step 0: the skeleton (whoever is free first, about 1 day)**
The thinnest chat that works end to end, with fake answers. Merged into `feature/chatbot` before anyone builds on it.
- Conversation and message storage. Each message points to the one before it, so they form a tree (CB-04 needs that later, with no migration).
- `POST /chat` returning a **placeholder answer** in the final shape: answer text, citations (passage, document, title, edition, page, position) and a `declined` flag. The placeholder:
  - cites one real seeded passage, so the source pane has a real page to open;
  - declines when the question contains "unanswerable", so the knowledge gap button has something to trigger it;
  - adds a counter to its text, so each retry gives a visibly different answer;
  - echoes any extra context it was given ("Using: …"), so memory and report context can be seen arriving.
- A chat screen with three areas: conversation list (left), conversation (middle), source pane (right).
- A seed script with a few saved conversations, like `server/src/scripts/seed-gn01.ts`.
Step 0 counts as the first part of CB-01 (endpoint, screen) and CB-03 (storage), whoever builds it.

**3. Work that needs nothing, not even Step 0**
Whoever didn't build Step 0 starts with one of these:
- A: write CB-06's test set (questions, the passage that answers each, unanswerable questions, follow-up conversations).
- B: write CB-05's fact-picking step (conversation text in, lasting facts out) and test it on its own.

**4. What each story waits on**
| Story | Needs | Until it's there |
|---|---|---|
| CB-01 (A) | Step 0 | Nothing. It replaces the placeholder with real answers. |
| CB-06 (A) | Real answers from CB-01 to score | Test set first (see 3). |
| CB-02 (A) | A citation with page and position | The placeholder's seeded citation. |
| CB-08 (A) | Answers that decline | The placeholder's "unanswerable" trigger. |
| CB-03 (B) | Step 0 storage | Placeholder answers. |
| CB-04 (B) | Answers that differ on retry | The placeholder's counter. |
| CB-05 (B) | Answers that use extra context | The placeholder's echo. Seeded conversations to recall. |
| CB-07 (B) | Answers that use extra context; a settled section review screen | Build it last in the sprint. Other teammates are still changing that screen. |

The one real wait: B's stories only *answer well* once CB-01 replaces the placeholder. B gets that just by pulling `feature/chatbot`, with no code change, because the endpoint's shape doesn't change. Each story's tests mock the endpoint, so they don't depend on the placeholder.

**5. If the plan slips**
- A is late on CB-01: B carries on with placeholders. Their demos use real answers once CB-01 lands.
- B is late: A's stories don't touch B's code, except the message-action slot (retry, branch), which stays empty.
- Before the last 2 days: whoever is free runs every demo flow on `feature/chatbot` with real answers.

## Settled so far (2026-10-09)
1. A or B: the teammate picks; Jesper takes the other.
2. CB-05: facts save automatically (AC1); the user can see and delete them (AC4, AC5).
3. CB-07: built last in the sprint, once the section review screen settles. Other teammates are still changing it.
