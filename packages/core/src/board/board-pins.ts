import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appDataDir } from '../store/paths.js';
import {
  boardPinIdentity,
  issueNeedsWorkspacePick,
  type AddBoardPinInput,
  type BoardPin,
} from './home-board.js';

const FILE = 'home-board-pins.json';
const VERSION = 1;

type DiskPins = {
  version: number;
  items: BoardPin[];
};

function pinsFile(): string {
  return join(appDataDir(), FILE);
}

function readDisk(): BoardPin[] {
  const path = pinsFile();
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as DiskPins;
    if (raw?.version !== VERSION || !Array.isArray(raw.items)) return [];
    return raw.items.filter((item) => item?.id && item.kind && item.ref);
  } catch {
    return [];
  }
}

function writeDisk(items: BoardPin[]): void {
  mkdirSync(appDataDir(), { recursive: true });
  writeFileSync(pinsFile(), JSON.stringify({ version: VERSION, items }, null, 2), 'utf8');
}

export function listBoardPins(): BoardPin[] {
  return readDisk();
}

export function addBoardPin(input: AddBoardPinInput): BoardPin {
  const ref = input.ref.trim();
  if (!ref) throw new Error('Board item needs a ref');
  const pin: BoardPin = {
    id: randomUUID(),
    kind: input.kind,
    ref,
    repoPath: input.repoPath.trim(),
    addedAt: new Date().toISOString(),
    title: input.title?.trim() || ref,
    url: input.url,
    labels: input.labels,
    provider: input.provider,
    assignee: input.assignee,
    cycle: input.cycle,
    teamKey: input.teamKey,
    headRefName: input.headRefName,
    author: input.author,
    remoteState: 'open',
    needsWorkspacePick: issueNeedsWorkspacePick(
      input.provider,
      input.workspaceCount ?? 1,
    ),
  };
  const items = listBoardPins();
  const identity = boardPinIdentity(pin);
  const existing = items.find((item) => boardPinIdentity(item) === identity);
  if (existing) {
    const merged = { ...existing, ...pin, id: existing.id, addedAt: existing.addedAt };
    writeDisk(items.map((item) => (item.id === existing.id ? merged : item)));
    return merged;
  }
  writeDisk([...items, pin]);
  return pin;
}

export function removeBoardPin(id: string): boolean {
  const items = listBoardPins();
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return false;
  writeDisk(next);
  return true;
}

export function replaceBoardPins(items: BoardPin[]): void {
  writeDisk(items);
}

export function clearBoardPins(): void {
  try {
    unlinkSync(pinsFile());
  } catch {
    // ignore
  }
}
