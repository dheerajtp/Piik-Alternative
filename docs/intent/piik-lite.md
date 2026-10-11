# Intent: Piik-lite

Confirmed via interview. This is the statement of intent, not a spec.

- **Outcome:** A minimal, own-code "Piik-lite": the host shares their screen
  (with system/tab audio, optional microphone) from a desktop browser; 2-5
  friends watch and text-chat in the browser (desktop or phone) through a single
  invite link.
- **User:** You (host) plus a few friends. It is a project you build and own.
- **Why now:** You want a private, lasting, free home for screen share + chat,
  and building the minimal version yourself is the point - not rebranding Piik.
- **Success:** A friend opens your link on any device, sees your screen with
  sound, and can chat. Sessions run 3-5 hours reliably. Hosting costs $0.
- **Constraint:** Node/JavaScript stack. Pure P2P (no SFU). Free always-on VM
  (e.g. Oracle Cloud Always Free). HTTPS required for capture. Host capture is
  desktop-only.
- **Out of scope:** rebranding/forking Piik; 6+ viewers; accounts/login;
  persistent chat history; reactions/overlays; recording; mobile *hosting*;
  paid infrastructure.

## Confirmed feature set (v1)

1. Screen share (video) from the host's desktop browser.
2. System/tab audio - required.
3. Microphone - optional on/off toggle.
4. Text chat with display names.
5. Shareable invite link.
6. Viewers on desktop and phones (browser, no install).

## Rejected alternatives

- Hosting Piik Server on Vercel - platform mismatch (needs long-lived process,
  public UDP, persistent SQLite).
- Using demo.piik.tv long-term - no uptime guarantee, shared/public, not
  private, not yours.
- Forking/rebranding Piik - rejected: the build itself is the goal.
