import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { alreadyPosted, postedBody } from "../src/relay.js";

const MARKER = "## From browser (chatgpt) assistant";
const FROM = "web-ai";

const post = (text) => ({ from: FROM, text: `${MARKER}\n\n${text}` });

describe("relay dedup", () => {
  it("suppresses an exact repost", () => {
    const history = [post("the complete answer")];
    assert.equal(alreadyPosted(history, FROM, MARKER, "the complete answer"), true);
  });

  it("lets the completed answer through after a truncated one was posted", () => {
    // The regression that matters: a partial and its finished version share a
    // prefix, so prefix-overlap dedup would drop the real answer.
    const partial =
      "For the completion signal, I'd avoid inferring from the DOM. A few approaches:" +
      " 1. Observe the composer state. During generation the UI changes state";
    const complete = `${partial}, then reverts when generation finishes. 2. Use the accessibility tree. 3. Network-level completion.`;

    const history = [post(partial)];
    assert.equal(
      alreadyPosted(history, FROM, MARKER, complete),
      false,
      "completed answer must not be treated as a duplicate of its own partial"
    );
  });

  it("still suppresses a shorter partial once the full answer is posted", () => {
    const complete = "one two three four five six seven eight nine ten eleven twelve";
    const partial = "one two three four five six seven";
    const history = [post(complete)];
    assert.equal(alreadyPosted(history, FROM, MARKER, partial), true);
  });

  it("ignores messages from other senders", () => {
    const history = [{ from: "claude", text: `${MARKER}\n\nsomething` }];
    assert.equal(alreadyPosted(history, FROM, MARKER, "something"), false);
  });

  it("ignores posts under a different marker", () => {
    const history = [
      { from: FROM, text: `## From browser (chatgpt) user\n\nhello there friend` },
    ];
    assert.equal(alreadyPosted(history, FROM, MARKER, "hello there friend"), false);
  });

  it("treats empty text as already posted rather than forwarding blanks", () => {
    assert.equal(alreadyPosted([], FROM, MARKER, ""), true);
    assert.equal(alreadyPosted([], FROM, MARKER, null), true);
  });

  it("forwards a genuinely different answer", () => {
    const history = [post("completely unrelated first answer about cats")];
    assert.equal(
      alreadyPosted(history, FROM, MARKER, "a totally different answer about databases"),
      false
    );
  });

  it("postedBody strips the marker and the relay truncation note", () => {
    const text = `${MARKER}\n\nthe answer\n\n_(relay: capture did not settle — timeout; may be truncated)_`;
    assert.equal(postedBody(text, MARKER), "the answer");
  });

  it("a note-annotated partial does not block its completed version", () => {
    const partial = "Here is the beginning of a long answer that got cut off midway";
    const history = [
      {
        from: FROM,
        text: `${MARKER}\n\n${partial}\n\n_(relay: capture did not settle — timeout-mid-stream; may be truncated)_`,
      },
    ];
    const complete = `${partial} and here is the rest of it, now complete.`;
    assert.equal(alreadyPosted(history, FROM, MARKER, complete), false);
  });
});
