import koffi from 'koffi';
import {
  cgModifierFlags,
  cgScrollWheels,
  macKeyCode,
  modifierKeyCode,
  type ComputerUseInput,
} from '@sideboard-ai/core';

const kCGHIDEventTap = 0;
const kCGEventLeftMouseDown = 1;
const kCGEventLeftMouseUp = 2;
const kCGEventMouseMoved = 5;
const kCGMouseButtonLeft = 0;
const kCGScrollEventUnitPixel = 0;
const kCGEventSourceStateHIDSystemState = 1;

type CgFn = (...args: any[]) => any;

type CgApi = {
  sourceCreate: CgFn;
  mouse: CgFn;
  keyboard: CgFn;
  unicode: CgFn;
  scroll: CgFn;
  setLocation: CgFn;
  setFlags: CgFn;
  post: CgFn;
  release: CgFn;
};

let api: CgApi | null = null;

function loadFramework(name: string): { func: (signature: string) => CgFn } {
  const path = `/System/Library/Frameworks/${name}.framework/${name}`;
  try {
    return koffi.load(path) as { func: (signature: string) => CgFn };
  } catch {
    return koffi.load(name) as { func: (signature: string) => CgFn };
  }
}

function cg(): CgApi {
  if (api) return api;
  koffi.struct('CGPoint', { x: 'double', y: 'double' });
  const coreGraphics = loadFramework('CoreGraphics');
  const coreFoundation = loadFramework('CoreFoundation');
  api = {
    sourceCreate: coreGraphics.func('void *CGEventSourceCreate(int32_t stateID)'),
    mouse: coreGraphics.func(
      'void *CGEventCreateMouseEvent(void *source, uint32_t mouseType, CGPoint mouseCursorPosition, uint32_t mouseButton)',
    ),
    keyboard: coreGraphics.func(
      'void *CGEventCreateKeyboardEvent(void *source, uint16_t virtualKey, bool keyDown)',
    ),
    unicode: coreGraphics.func(
      'void CGEventKeyboardSetUnicodeString(void *event, unsigned long length, uint16_t *unicodeString)',
    ),
    scroll: coreGraphics.func(
      'void *CGEventCreateScrollWheelEvent2(void *source, uint32_t units, uint32_t wheelCount, int32_t wheel1, int32_t wheel2, int32_t wheel3)',
    ),
    setLocation: coreGraphics.func('void CGEventSetLocation(void *event, CGPoint location)'),
    setFlags: coreGraphics.func('void CGEventSetFlags(void *event, uint64_t flags)'),
    post: coreGraphics.func('void CGEventPost(uint32_t tap, void *event)'),
    release: coreFoundation.func('void CFRelease(void *cf)'),
  };
  return api;
}

function release(ref: unknown): void {
  if (ref) cg().release(ref as never);
}

function withSource<T>(fn: (source: unknown) => T): T {
  const source = cg().sourceCreate(kCGEventSourceStateHIDSystemState as never);
  try {
    return fn(source);
  } finally {
    release(source);
  }
}

function postRef(ref: unknown): void {
  if (!ref) throw new Error('CoreGraphics did not create the event.');
  try {
    cg().post(kCGHIDEventTap as never, ref as never);
  } finally {
    release(ref);
  }
}

function move(source: unknown, x: number, y: number): void {
  const ref = cg().mouse(
    source as never,
    kCGEventMouseMoved as never,
    { x, y } as never,
    kCGMouseButtonLeft as never,
  );
  postRef(ref);
}

function keyTap(source: unknown, keyCode: number, down: boolean, flags: number): void {
  const ref = cg().keyboard(source as never, keyCode as never, down as never);
  if (!ref) throw new Error('CoreGraphics did not create the event.');
  try {
    if (flags) cg().setFlags(ref as never, flags as never);
    cg().post(kCGHIDEventTap as never, ref as never);
  } finally {
    release(ref);
  }
}

function typeText(source: unknown, text: string): void {
  const parts = text.split(/\r\n|\n|\r/);
  for (let i = 0; i < parts.length; i += 1) {
    for (const char of parts[i]) {
      const units = Buffer.from(char, 'utf16le');
      const down = cg().keyboard(source as never, 0 as never, true as never);
      if (!down) throw new Error('CoreGraphics did not create the event.');
      try {
        cg().unicode(down as never, (units.length / 2) as never, units as never);
        cg().post(kCGHIDEventTap as never, down as never);
      } finally {
        release(down);
      }
      const up = cg().keyboard(source as never, 0 as never, false as never);
      postRef(up);
    }
    if (i < parts.length - 1) {
      keyTap(source, 36, true, 0);
      keyTap(source, 36, false, 0);
    }
  }
}

function keyChord(source: unknown, key: string, modifiers: string[]): void {
  const flags = cgModifierFlags(modifiers);
  const code = macKeyCode(key);
  const mods = modifiers
    .map((name) => modifierKeyCode(name))
    .filter((item): item is number => item !== null);
  for (const mod of mods) keyTap(source, mod, true, 0);
  if (code !== null) {
    keyTap(source, code, true, flags);
    keyTap(source, code, false, flags);
  } else if (key.length === 1) {
    const units = Buffer.from(key, 'utf16le');
    const down = cg().keyboard(source as never, 0 as never, true as never);
    if (!down) throw new Error('CoreGraphics did not create the event.');
    try {
      cg().unicode(down as never, (units.length / 2) as never, units as never);
      if (flags) cg().setFlags(down as never, flags as never);
      cg().post(kCGHIDEventTap as never, down as never);
    } finally {
      release(down);
    }
    const up = cg().keyboard(source as never, 0 as never, false as never);
    if (up && flags) cg().setFlags(up as never, flags as never);
    postRef(up);
  } else {
    throw new Error(`unsupported key ${key}`);
  }
  for (const mod of mods.reverse()) keyTap(source, mod, false, 0);
}

export function postComputerUseEvent(event: ComputerUseInput): void {
  withSource((source) => {
    if (event.type === 'click') {
      move(source, event.x, event.y);
      const down = cg().mouse(
        source as never,
        kCGEventLeftMouseDown as never,
        { x: event.x, y: event.y } as never,
        kCGMouseButtonLeft as never,
      );
      postRef(down);
      const up = cg().mouse(
        source as never,
        kCGEventLeftMouseUp as never,
        { x: event.x, y: event.y } as never,
        kCGMouseButtonLeft as never,
      );
      postRef(up);
      return;
    }
    if (event.type === 'type') {
      typeText(source, event.text);
      return;
    }
    if (event.type === 'key') {
      keyChord(source, event.key, event.modifiers);
      return;
    }
    move(source, event.x, event.y);
    const { wheel1, wheel2 } = cgScrollWheels(event.dx, event.dy);
    const ref = cg().scroll(
      source as never,
      kCGScrollEventUnitPixel as never,
      2 as never,
      wheel1 as never,
      wheel2 as never,
      0 as never,
    );
    if (!ref) throw new Error('CoreGraphics did not create the event.');
    try {
      cg().setLocation(ref as never, { x: event.x, y: event.y } as never);
      cg().post(kCGHIDEventTap as never, ref as never);
    } finally {
      release(ref);
    }
  });
}
