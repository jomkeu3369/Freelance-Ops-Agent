import type { PixelPetSprite } from "@/app/lib/api";

/** 같은 색의 가로 픽셀을 묶어 작은 SVG 경로로 그린다. */
export function PixelPetArt({ sprite, state }: { sprite: PixelPetSprite; state: string }) {
  const paths = Array.from({ length: 15 }, () => "");
  for (let y = 0; y < 32; y++) {
    const row = sprite.rows[y] ?? "";
    for (let x = 0; x < 32; ) {
      const symbol = row[x];
      const start = x++;
      if (!symbol || symbol === ".") continue;
      while (x < 32 && row[x] === symbol) x++;
      const color = Number.parseInt(symbol, 16);
      if (color >= 0 && color < 15) paths[color] += `M${start} ${y}h${x - start}v1H${start}z`;
    }
  }
  return (
    <svg
      className={`pet-art pet-pixel pet-${state}`}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <g className="pet-body">
        {paths.map(
          (path, index) =>
            path && (
              <path
                key={index}
                d={path}
                fill={/^#[0-9a-f]{6}$/i.test(sprite.palette[index] ?? "") ? sprite.palette[index] : "transparent"}
              />
            )
        )}
      </g>
    </svg>
  );
}
