type StudentStimulusProps = {
  questionId: string;
  questionText: string;
  instructionText?: string;
  preview?: boolean;
};

export function StudentStimulus({ questionId, questionText, instructionText, preview = false }: StudentStimulusProps) {
  const displayText = questionText.replace("BACA:", "").trim();
  const contentParts = parseStimulusContent(displayText);
  const textOnly = contentParts.filter((part) => part.type === "text").map((part) => part.value).join("\n");
  const isLongText = textOnly.length > 36;

  return (
    <section className={preview ? "stimulus preview" : "stimulus"}>
      <div className="stimulus-meta">
        <span>{questionId}</span>
        <span>Asesmen</span>
      </div>
      <div className="stimulus-content">
        {contentParts.map((part, index) =>
          part.type === "image" ? (
            <img className="stimulus-image" src={part.value} alt={`Stimulus ${questionId}`} key={`${part.value}-${index}`} />
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
  return sourceLines.map((line) => {
    const imageUrl = getImageUrl(line);
    return imageUrl ? { type: "image", value: imageUrl } : { type: "text", value: line };
  });
}

function getImageUrl(value: string) {
  const trimmed = value.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return "";
  try {
    const url = new URL(trimmed);
    return /\.(jpe?g|png|bmp|svg)(\?.*)?$/i.test(url.pathname + url.search) ? trimmed : "";
  } catch {
    return "";
  }
}
