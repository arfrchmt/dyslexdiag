type StudentStimulusProps = {
  questionId: string;
  questionText: string;
  instructionText?: string;
  selectedAnswer?: string;
  preview?: boolean;
};

export function StudentStimulus({ questionId, questionText, instructionText, selectedAnswer = "", preview = false }: StudentStimulusProps) {
  const displayText = questionText
    .replace("BACA:", "")
    .replace(/\?\$\$\?/g, selectedAnswer || "____")
    .replace(/\$\?\?\$/g, "???")
    .trim();
  const contentParts = parseStimulusContent(displayText);
  const textOnly = contentParts.filter((part) => part.type === "text").map((part) => part.value).join("\n");
  const isLongText = textOnly.length > 36;

  return (
    <section className={preview ? "stimulus preview" : "stimulus"} data-gaze-component="stimulus" data-gaze-label={questionId}>
      <div className="stimulus-meta">
        <span>{questionId}</span>
        <span>Asesmen</span>
      </div>
      <div className="stimulus-content" data-gaze-component="stimulus-content">
        {contentParts.map((part, index) =>
          part.type === "image" ? (
            <img className="stimulus-image" src={part.value} alt={`Stimulus ${questionId}`} key={`${part.value}-${index}`} />
          ) : part.type === "audio" ? (
            <audio className="stimulus-media" controls src={part.value} key={`${part.value}-${index}`} />
          ) : part.type === "video" ? (
            <video className="stimulus-media" controls playsInline src={part.value} key={`${part.value}-${index}`} />
          ) : (
            <p className={isLongText ? "long" : ""} key={`${part.value}-${index}`}>
              {part.value}
            </p>
          )
        )}
      </div>
      <p className="stimulus-instruction">{instructionText ?? "Ikuti instruksi soal yang tampil."}</p>
    </section>
  );
}

function parseStimulusContent(value: string) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sourceLines = lines.length > 0 ? lines : [value.trim()];
  return sourceLines.flatMap((line) => splitLineByImageUrl(line));
}

function splitLineByImageUrl(line: string) {
  const parts: Array<{ type: "image" | "audio" | "video" | "text"; value: string }> = [];
  const mediaUrlPattern = /https?:\/\/\S+\.(?:jpe?g|png|gif|webp|bmp|svg|mp3|wav|ogg|m4a|aac|mp4|webm|mov|m4v)(?:\?\S*)?/gi;
  let cursor = 0;
  for (const match of line.matchAll(mediaUrlPattern)) {
    const index = match.index ?? 0;
    const before = line.slice(cursor, index).trim();
    if (before) parts.push({ type: "text", value: before });
    parts.push({ type: getMediaType(match[0]), value: match[0] });
    cursor = index + match[0].length;
  }
  const after = line.slice(cursor).trim();
  if (after) parts.push({ type: "text", value: after });
  if (parts.length > 0) return parts;
  const mediaType = getMediaType(line);
  return mediaType === "text" ? [{ type: "text", value: line }] : [{ type: mediaType, value: line }];
}

function getMediaType(value: string): "image" | "audio" | "video" | "text" {
  const trimmed = value.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return "text";
  try {
    const url = new URL(trimmed);
    const source = `${url.pathname}${url.search}`;
    if (/\.(jpe?g|png|gif|webp|bmp|svg)(\?.*)?$/i.test(source)) return "image";
    if (/\.(mp3|wav|ogg|m4a|aac)(\?.*)?$/i.test(source)) return "audio";
    if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(source)) return "video";
  } catch {
    return "text";
  }
  return "text";
}
