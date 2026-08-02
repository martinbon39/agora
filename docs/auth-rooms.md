# Rooms instead of passkeys

Status: **proposal**, not built. One open question at the bottom needs Martin's
call before anyone implements it.

## The problem with what ships today

Passkeys are the right primitive for the person who owns the box and the wrong
one for everybody else. Today a guest has to have a Google account allowlisted or
go through an invite that still ends in a credential ceremony. At a hackathon
that is three minutes of friction per person and a support conversation for
anyone whose browser does not cooperate.

The film promises "invite anyone, nothing to install". The auth model does not
currently deliver that.

## The shape

**A room is the unit of access.** It already exists in the codebase (rooms,
scope, tenants and spectate all have gates), so this is mostly wiring rather than
new machinery.

- **The owner still authenticates properly.** Whoever owns the server keeps the
  filesystem-minted credential. Only the owner creates rooms, adds projects,
  and starts sessions with arbitrary commands. This does not change.
- **A room has a link.** High-entropy token in the URL fragment, never a path
  segment: a path segment lands in the request log on every hit, which is the
  bug atlas already fixed once on the invite route.
- **Joining is: open the link, type your name, you are in.** No account, no
  password, no passkey. The name is the whole identity: it is what shows on your
  cursor, your presence badge on a terminal, and your sticky notes. That is all
  the identity a room needs, and it is what makes the multiplayer act in the film
  true rather than aspirational.
- **A room can expire.** Already in the product's vocabulary. When it does, the
  compute is freed and the work is not.
- **Revocation is rotating the room token.** Every guest drops instantly.
  Re-scoping already applies to open sessions, so this path exists.

## The thing that cannot be hand-waved

agora gives a browser a shell on your server. If a room link grants terminal
input, then the link *is* the shell. At a hackathon that link gets pasted into a
Discord channel, and it will outlive the event.

So a guest must not be able to:

- start a session with a command they choose
- reach anything outside that room's project directory
- see other rooms or other projects
- mint further invites

Those are the boundaries `gate-scope.mjs` and `gate-paths.mjs` already assert.
The redesign must keep every one of them green, and add a gate proving a room
guest cannot escalate to any of them.

## The open question, for Martin

**Can a guest type into a terminal, or only watch?**

- **Type**: matches the film exactly, someone walks into a session and takes the
  keyboard. It is the strongest thing the product does. It also means the room
  link is worth as much as shell access to that one project.
- **Watch**: the room link is safe to paste anywhere. Guests see the canvas, the
  board and the terminals live but cannot input. The public wall already works
  this way.

The honest middle is **watch by default, and the owner promotes a named guest to
typing with one click**, which the presence list makes natural: you can see who
is in the room, so you can see who you are handing the keyboard to. That keeps
the film's claim true and keeps a leaked link from being a shell.

That is a product call, not a technical one. Nothing should be built until it is
answered.
