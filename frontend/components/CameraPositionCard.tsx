import { Camera, CheckCircle2 } from "lucide-react";

type CameraPositionCardProps = {
  compact?: boolean;
};

export function CameraPositionCard({ compact = false }: CameraPositionCardProps) {
  return (
    <section className={compact ? "camera-card compact" : "camera-card"}>
      <div className="camera-frame">
        <div className="face-oval" />
        <div className="target-box" />
        <div className="camera-badge">
          <Camera size={14} />
          <span>Preview</span>
        </div>
      </div>
      <div className="camera-status ok">
        <CheckCircle2 size={16} />
        <span>Posisi kamera sesuai</span>
      </div>
    </section>
  );
}
