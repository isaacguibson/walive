import { describe, expect, it } from 'vitest';
import { nextPlaybackIndex } from '@editor/playback/playbackController';
import { FakeClock, makeSession, paintRed, pixelAt, TRANSPARENT } from './helpers';

function setup(frames = 3) {
  const clock = new FakeClock();
  const session = makeSession({ clock });
  if (frames > 1) {
    session.addFrames(frames - 1);
  }
  session.selectFrame(session.getSnapshot().frames[0]?.id ?? '');
  session.setFps(10);
  const activeIndex = () => session.getSnapshot().frames.findIndex((frame) => frame.id === session.getSnapshot().state.activeFrameId);
  return { clock, session, activeIndex };
}

describe('nextPlaybackIndex', () => {
  it('advances, wraps when looping and ends otherwise', () => {
    expect(nextPlaybackIndex(3, 0, true)).toBe(1);
    expect(nextPlaybackIndex(3, 2, true)).toBe(0);
    expect(nextPlaybackIndex(3, 2, false)).toBeNull();
    expect(nextPlaybackIndex(0, 0, true)).toBeNull();
    expect(nextPlaybackIndex(3, -1, false)).toBe(0);
  });
});

describe('playback', () => {
  it('moves through the frames at the configured FPS and loops by default', () => {
    const { clock, session, activeIndex } = setup();
    expect(session.getSnapshot().state.loopPlayback).toBe(true);
    expect(session.play()).toBe(true);
    expect(session.getSnapshot().state.isPlaying).toBe(true);

    clock.advance(99);
    expect(activeIndex()).toBe(0);
    clock.advance(1);
    expect(activeIndex()).toBe(1);
    clock.advance(100);
    expect(activeIndex()).toBe(2);
    clock.advance(100);
    expect(activeIndex()).toBe(0);
    expect(session.getSnapshot().state.isPlaying).toBe(true);
  });

  it('stops after the last frame when looping is disabled', () => {
    const { clock, session, activeIndex } = setup();
    session.setLoop(false);
    session.play();
    clock.advance(200);
    expect(activeIndex()).toBe(2);
    expect(session.getSnapshot().state.isPlaying).toBe(true);
    clock.advance(100);
    expect(session.getSnapshot().state.isPlaying).toBe(false);
    expect(activeIndex()).toBe(2);
    expect(clock.pending).toBe(0);
  });

  it('restarts from the first frame when played from the end without looping', () => {
    const { clock, session, activeIndex } = setup();
    session.setLoop(false);
    session.selectFrame(session.getSnapshot().frames[2]?.id ?? '');
    session.play();
    expect(activeIndex()).toBe(0);
    clock.advance(100);
    expect(activeIndex()).toBe(1);
  });

  it('can be stopped and leaves the current frame selected', () => {
    const { clock, session, activeIndex } = setup();
    session.play();
    clock.advance(100);
    session.stop();
    expect(session.getSnapshot().state.isPlaying).toBe(false);
    expect(clock.pending).toBe(0);
    clock.advance(1000);
    expect(activeIndex()).toBe(1);
  });

  it('toggles between play and stop', () => {
    const { session } = setup();
    session.togglePlayback();
    expect(session.getSnapshot().state.isPlaying).toBe(true);
    session.togglePlayback();
    expect(session.getSnapshot().state.isPlaying).toBe(false);
  });

  it('applies a new FPS while playing', () => {
    const { clock, session, activeIndex } = setup();
    session.play();
    session.setFps(20);
    // The pending tick keeps its schedule; the new speed applies from the following one.
    clock.advance(100);
    expect(activeIndex()).toBe(1);
    clock.advance(49);
    expect(activeIndex()).toBe(1);
    clock.advance(1);
    expect(activeIndex()).toBe(2);
  });

  it('ignores an invalid FPS and keeps playing at the previous one', () => {
    const { clock, session, activeIndex } = setup();
    session.play();
    expect(session.setFps('0')).toBe(false);
    clock.advance(100);
    expect(activeIndex()).toBe(1);
  });

  it('plays a single-frame animation without moving', () => {
    const { clock, session } = setup(1);
    expect(session.play()).toBe(true);
    clock.advance(500);
    expect(session.getSnapshot().frames).toHaveLength(1);
    expect(session.getSnapshot().state.isPlaying).toBe(true);
  });

  it('blocks editing and drawing while playing', () => {
    const { session } = setup();
    session.play();
    session.addFrame();
    session.addLayer();
    paintRed(session);
    session.undo();
    expect(session.getSnapshot().frames).toHaveLength(3);
    expect(pixelAt(session, 5, 5)).toEqual(TRANSPARENT);
    expect(session.getSnapshot().canUndo).toBe(true);
  });

  it('stops when a frame is selected manually', () => {
    const { session } = setup();
    session.play();
    session.selectFrame(session.getSnapshot().frames[2]?.id ?? '');
    expect(session.getSnapshot().state.isPlaying).toBe(false);
  });

  it('does not create undo entries or change the saved state', () => {
    const { clock, session } = setup();
    session.markSaved(session.createSaveRequest().token);
    const clean = session.getSnapshot().isDirty;
    session.play();
    clock.advance(1000);
    expect(session.getSnapshot().isDirty).toBe(clean);
  });

  it('dispose stops playback and timers', () => {
    const { clock, session } = setup();
    session.play();
    session.dispose();
    expect(clock.pending).toBe(0);
  });

  it('does not start while a drawing gesture is active', () => {
    const { session } = setup();
    session.pointerDown({ x: 1, y: 1, pointerId: 1, buttons: 1 });
    expect(session.play()).toBe(false);
  });
});
