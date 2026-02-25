import { useState } from "react";
import { Package } from "lucide-react";
import { partImageSources } from "@/lib/part-image";

interface PartImageProps {
  imageUrl?: string | null;
  partNumber?: string | null;
  colorId?: number | null;
  itemType?: string | null;
  className?: string;
  fallbackClassName?: string;
}

/**
 * Shared part image component used across Showroom, Inventory Detail, and Picklist.
 *
 * Tries each source URL in order until one loads:
 *   1. Database imageUrl (Rebrickable, proxied through our server)
 *   2. BrickLink color-specific CDN
 *   3. BrickLink shape-only CDN
 *   4. Package icon placeholder
 */
export default function PartImage({
  imageUrl,
  partNumber,
  colorId,
  itemType,
  className = "w-full h-full object-contain",
  fallbackClassName,
}: PartImageProps) {
  const srcs = partImageSources(imageUrl, partNumber, colorId, itemType);
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
