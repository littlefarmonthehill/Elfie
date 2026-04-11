import { useState } from "react";
import { Package } from "lucide-react";
import { partImageSources } from "@/lib/part-image";

interface PartImageProps {
  imageUrl?: string | null;
  partNumber?: string | null;
  colorId?: number | null;
  itemType?: string | null;
  lotId?: number | null;
  className?: string;
  fallbackClassName?: string;
}

/**
 * Shared part image component used across inventory, orders, picklist, and all channels.
 *
 * Tries each source URL in order until one loads:
 *   0. /api/images/lot/:lotId  — global resolver (user images → catalog) when lotId is provided
 *   1. /api/images/parts/:partNum/:colorId  — catalog image via server proxy
 *   2. Database imageUrl (Rebrickable or BL CDN URL), proxied if needed
 *   3. BrickLink CDN direct
 *   4. BrickLink shape-only CDN
 *   5. Package icon placeholder
 */
export default function PartImage({
  imageUrl,
  partNumber,
  colorId,
  itemType,
  lotId,
  className = "w-full h-full object-contain",
  fallbackClassName,
}: PartImageProps) {
  const srcs = partImageSources(imageUrl, partNumber, colorId, itemType, lotId);
  const [level, setLevel] = useState(0);

  if (level >= srcs.length) {
    return <Package className={fallbackClassName ?? "w-10 h-10 text-gray-600"} />;
  }

  return (
    <img
      key={srcs[level]}
      src={srcs[level]}
      alt=""
      className={className}
      onError={() => setLevel(l => l + 1)}
    />
  );
}
