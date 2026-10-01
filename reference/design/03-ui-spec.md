# 03 · UI specification

## Visual direction

**convos /** is a small editorial workspace, not an analytics dashboard. A warm neutral sidebar, white reading surface, charcoal text, and restrained green actions keep the conversation primary. Light borders define sections; the important action is the review decision, not a large animated AI treatment.

The prototype is an interaction reference. Text is synthetic, the name is provisional, and the CSS is transferable. `prototype/src/styles.css` defines tokens at `:root`; no font assets or remote image resources are required. Use authored CSS with `wind: false` for the zfb 3.0.0 port. Preserve the prototype's explicit reset/tokens; do not introduce an implicit utility palette or translate every declaration into utilities.

Key prototype dimensions: 254px standalone navigation; up to 814px conversation region; optional 286px details rail; 12px card corners; 44px demo-control strip on desktop. Body text is 13px desktop/12px compact in the artifact. Review local font rendering and increase reading size where needed instead of shrinking it to fit screenshots. The demo strip is not production chrome.

## Layout A — Standalone viewer (recommended primary example)

The sidebar contains workspace identity, New conversation, Conversations/Skills, search, recent threads, and archived threads. Search filters titles in the prototype; server-side title search with scoped pagination is the first production implementation. Full-text content search is deferred.

The header identifies the assistant/conversation and provides saved state, Details, and an actions menu. Show a saved label only when the represented data is durably accepted. Unsent browser drafts and failed send requests must not borrow that label. Run status is independent and visible where work happens.

The transcript uses a compact user bubble and open assistant prose. Expandable tool activity contains user-safe facts about steps taken, not hidden chain-of-thought. Proposals appear inline at the relevant assistant turn, rather than in an unrelated full-screen approval flow. Completed and rejected proposal history remains available.

The composer stays outside the transcript scroller. A new message is accepted only when there is no active run in that conversation. During pending review, Request changes closes the current proposal and focuses the composer with a useful lead-in. While generation is running, the action is Stop rather than Send.

Details has three views: Run for status/outcomes and safe step summaries; Context for exact skill pins and history/cache boundaries; Events for sequence and recovery diagnostics. The public-facing product need not expose internal IDs; operator-safe diagnostics can show opaque IDs under a deliberate disclosure.

## Layout B — Embedded in a CMS

The same conversation surface sits beside a minimal host page preview. There is no second conversation implementation. The host handles authentication, workspace/resource context, page revisions, and approved effects. The sample deliberately does not implement page publishing, asset management, or a general CMS editor.

At a wide viewport, the host and conversation are adjacent. Below 920px, the conversation becomes the primary surface and host context can move to a back link/host navigation. The prototype hides the host example at that breakpoint. Embedded conversation history opens in a drawer, not a permanently duplicated sidebar. Approval updates the synthetic host preview; the live integration waits for an actual host receipt.

Changing the host page should not silently repurpose an existing conversation. Bind explicit context to the accepted run, and show a scope/context change before starting work with a different resource.

## Skills surface

Skills are workspace-level instructions. List the name, concise purpose, and current version. Show current instructions separately from history. Editing requires a change note and expected current head; a concurrent edit produces a visible conflict rather than replacing another revision.

History shows version, date, change note, and a real line diff. Restore reads an earlier immutable body and appends a new head; the button says **Restore as vN**, not “rewind all runs.” When a historical pin is opened from Context, land directly on that version. Existing runs remain pinned even when the current head changes.

The prototype uses a simple line-membership comparison, not an accurate diff for repeated/reordered lines. Replace it with a tested text diff before production. The history behavior and button semantics—not that algorithm—are the reference.

## State matrix

| State | Transcript / status | Composer and recovery |
| --- | --- | --- |
| Empty | Small purpose statement and three sample tasks | Enabled; examples populate a draft, do not send automatically |
| Accepted/queued | Saved user turn + queued run | Disabled while active; cancellation available |
| Running | Partial assistant output and current safe activity | Stop; switching threads is allowed |
| Awaiting approval | Immutable proposal card and complete-change disclosure | Disabled; approve or request changes |
| Approval accepted/applying | Explicit “Applying” status until a host receipt | No second apply; do not show success from approval HTTP acceptance alone |
| Completed | Actual result and host effect receipt | Enabled for the next request |
| Rejected | Proposal closed, no effect | Enabled; request-changes action focuses draft |
| Failed before effect | Preserved partial content and clear failure | Retry creates new run, same input snapshot/user turn |
| Connection lost | Connection banner; run outcome is unknown to the view | Reconnect/catch-up; never assume failure or resend automatically |
| Stale proposal | No changes applied; old proposal cannot be approved | Prepare a new proposal with fresh context |
| Cancellation requested | Show intent without claiming the tool stopped | Await acknowledgement; no automatic undo |
| Cancelled | Partial response retained | Retry where safe |
| Needs reconciliation | “The result of this change is not yet confirmed” | No blind retry; operator/host effect lookup |
| Archived | Readable history with an archived hint | Restore before sending; no delete claim |

Queued, applying, cancellation-requested, and reconciliation are **specified production states**, not fully interactive asynchronous scenarios in this prototype. The mock applies a synthetic draft synchronously and stops its own timer immediately. The local agent must implement the intermediate states before wiring a live backend.

## Prototype scenarios

The dropdown supplies seven deterministic starting states. Changing it resets synthetic conversations, edits, skill revisions, and drafts. Reset also has an explicit confirmation dialog. Keep these controls in a developer/mock-only surface.

**Ready for review:** normal approval or request-changes path. **Streaming response:** incremental mock output and Stop. **Reconnect & replay:** freeze the view while the in-page mock service progresses, then catch up. **Stale proposal:** the host revision is already newer; clicking approval exposes the conflict. **Interrupted run:** retry a recorded failed attempt without duplicating its user turn. **New conversation:** empty state and composer. **Long history:** history scrolling without forced jumps when Details opens.

The mock service keeps arrays/snapshots; its reconnect demonstration is not the full production event reducer. The proposed reducer is delivered separately under `contracts/` and has its own tests. Both must be unified in P1/P2.

## Keyboard, focus, and motion

Use Enter to send and Shift+Enter for a newline. Ignore submit shortcuts during IME composition, including the legacy keyCode 229 fallback where needed. Ctrl/Meta+Enter can be added later as a setting, but is not necessary to complete this recipe.

Escape closes only the active modal/drawer. It must not cancel a run, discard a draft, or submit a review decision. The recipe does not introduce a Vim mode. Native modal dialogs in the prototype trap focus and return it to the opener; verify equivalent behavior after the component port.

Keep focus/selection/IME state stable during streamed updates. Auto-follow the transcript only when the reader is already near the bottom; otherwise preserve an item-based anchor and expose Latest. The artifact preserves scroll offsets, but production should use stable keyed message nodes and an anchor because older-page prepends change heights.

Announce important transitions in a polite live region, not every token. Prefer reduced motion for scrolling/indicators when requested. Icon buttons require accessible names; statuses need text, not color alone. Aim for at least 44px touch targets for primary mobile actions, and test with an actual touch device and screen reader. The viewport checks here are not a full accessibility audit.

## Mobile and keyboard layout

Use `100dvh`, a fixed app shell, a flexing transcript with `min-height: 0`, and a composer outside that scroller. Account for safe areas. Do not attach a global scroll-to-bottom handler to every viewport resize; keyboard appearance and selection can cause those events.

On narrow screens, use a navigation drawer and a details drawer; keep neither as a persistent column. The preserved HTML prototype uses a select for skills; the **v3 implementation changes that control** to a compact chooser button opening a native dialog with a keyed skill list. v3 supports only static option structures in native selects, so live-added/renamed skills must not be implemented as reactive `<option>` nodes. A fixed fixture-only scenario selector may remain a native select. See document 08. Do not let an open drawer coexist with an independently focusable hidden application.

Actual iOS Safari and Android keyboard behavior still requires local device testing. The supplied test widths—360, 390, 768, 1024, and 1440—prove layout constraints, not hardware keyboards, virtual keyboard resizing, or assistive technology behavior.

## Component mapping for the port

```text
ConversationWorkspace
  ConversationNavigation
  ConversationHeader
  ConversationSurface
    ConnectionNotice
    MessageList → MessageItem → ProposalCard / ToolActivity
    LatestControl
    Composer
  ConversationDetails
SkillsWorkspace
  SkillNavigation
  MobileSkillChooserDialog
  SkillDocument
  SkillHistory
  SkillEditorDialog
ShowcaseLabControls             # mock-only, outside product components
ExampleCmsHost                  # demo adapter, outside core
```

Inside the hydrated client tree, host inputs are an explicit client instance, conversation/workspace context, user-safe assistant metadata, callbacks for navigation/effect receipts, and capability views. The **Island server/client boundary is different**: only public, JSON-safe bootstrap props cross it. Construct client instances, signals, and callbacks inside the activated client root and pass them to descendants explicitly; do not serialize them or credentials into island props. UI-local state includes draft text, selected thread/skill, open details tab, focus/scroll anchors, and pending command keys; server state comes from the client projection.

## Review artifacts

Eight screenshots are included: standalone review, run details, applied outcome, stale proposal, skill history, embedded host, mobile review, and mobile skills. They are actual Chromium renders of the supplied HTML, not image-generated mockups. `tests/browser_smoke.py` recreates them while exercising the UI.
