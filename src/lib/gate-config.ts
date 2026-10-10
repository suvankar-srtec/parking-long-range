export type GateDirection = "SELECT" | "ENTRY" | "EXIT" | "ENTRY_EXIT";

const DIRECTIONS = new Set<GateDirection>(["SELECT", "ENTRY", "EXIT", "ENTRY_EXIT"]);
const LEGACY_READER_SEPARATOR = "::READER::";
const ENTRY_READER_SEPARATOR = "::ENTRY_READER::";
const EXIT_READER_SEPARATOR = "::EXIT_READER::";

export type ParsedGateConfig = {
  direction: GateDirection;
  /** Backward-compatible single-reader view. Prefer entryReaderId / exitReaderId. */
  readerId: string | null;
  entryReaderId: string | null;
  exitReaderId: string | null;
};

export function isGateDirection(value: unknown): value is GateDirection {
  return typeof value === "string" && DIRECTIONS.has(value as GateDirection);
}

function valueBetween(raw: string, marker: string, nextMarker?: string) {
  const start = raw.indexOf(marker);
  if (start < 0) return "";
  const valueStart = start + marker.length;
  const end = nextMarker ? raw.indexOf(nextMarker, valueStart) : -1;
  return raw.slice(valueStart, end >= 0 ? end : undefined).trim();
}

export function parseGateConfig(value: unknown): ParsedGateConfig {
  const raw = String(value ?? "").trim();
  if (!raw) return { direction: "SELECT", readerId: null, entryReaderId: null, exitReaderId: null };

  const firstMarkerPositions = [
    raw.indexOf(LEGACY_READER_SEPARATOR),
    raw.indexOf(ENTRY_READER_SEPARATOR),
    raw.indexOf(EXIT_READER_SEPARATOR),
  ].filter((position) => position >= 0);
  const firstMarker = firstMarkerPositions.length ? Math.min(...firstMarkerPositions) : -1;
  const directionText = firstMarker >= 0 ? raw.slice(0, firstMarker) : raw;
  const direction: GateDirection = isGateDirection(directionText) ? directionText : "SELECT";

  let entryReaderId: string | null = null;
  let exitReaderId: string | null = null;

  const hasNewFormat = raw.includes(ENTRY_READER_SEPARATOR) || raw.includes(EXIT_READER_SEPARATOR);
  if (hasNewFormat) {
    const entryText = valueBetween(raw, ENTRY_READER_SEPARATOR, EXIT_READER_SEPARATOR);
    const exitText = valueBetween(raw, EXIT_READER_SEPARATOR);
    entryReaderId = entryText || null;
    exitReaderId = exitText || null;
  } else {
    const legacyReader = valueBetween(raw, LEGACY_READER_SEPARATOR) || null;
    if (direction === "ENTRY") entryReaderId = legacyReader;
    else if (direction === "EXIT") exitReaderId = legacyReader;
    else if (direction === "ENTRY_EXIT") entryReaderId = legacyReader;
  }

  if (direction === "SELECT") {
    entryReaderId = null;
    exitReaderId = null;
  } else if (direction === "ENTRY") {
    exitReaderId = null;
  } else if (direction === "EXIT") {
    entryReaderId = null;
  }

  return {
    direction,
    readerId: entryReaderId || exitReaderId,
    entryReaderId,
    exitReaderId,
  };
}

export function serializeGateConfig(
  direction: GateDirection,
  readerId?: string | null,
  exitReaderId?: string | null,
) {
  if (direction === "SELECT") return direction;

  const firstReader = String(readerId ?? "").trim() || null;
  const secondReader = String(exitReaderId ?? "").trim() || null;

  if (direction === "ENTRY") {
    return firstReader ? `${direction}${ENTRY_READER_SEPARATOR}${firstReader}` : direction;
  }

  if (direction === "EXIT") {
    const exitReader = secondReader || firstReader;
    return exitReader ? `${direction}${EXIT_READER_SEPARATOR}${exitReader}` : direction;
  }

  if (!firstReader && !secondReader) return direction;
  return `${direction}${ENTRY_READER_SEPARATOR}${firstReader ?? ""}${EXIT_READER_SEPARATOR}${secondReader ?? ""}`;
}

/** A directed gate assignment takes priority over a reader's general purpose. */
export function gateReaderDirection(config: ParsedGateConfig, readerId: string): GateDirection {
  if (config.direction !== "ENTRY_EXIT") return config.direction;
  const entry = config.entryReaderId === readerId;
  const exit = config.exitReaderId === readerId;
  if (entry && exit) return "ENTRY_EXIT";
  if (entry) return "ENTRY";
  if (exit) return "EXIT";
  return "SELECT";
}
