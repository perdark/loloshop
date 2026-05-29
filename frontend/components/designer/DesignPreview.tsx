"use client";

import { SashGownPreview } from "./SashGownPreview";

interface Props {
  sashColor: string;
  leftJson: unknown | null;
  rightJson: unknown | null;
  fontsUsed?: string[];
}

/** Step 3 — same yoke/tail layout as step 2 for WYSIWYG trust */
export function DesignPreview({ sashColor, leftJson, rightJson, fontsUsed }: Props) {
  return (
    <div className="space-y-2">
      <p className="text-center text-sm text-ink-soft">معاينة كما سيُلبس على الوشاح</p>
      <SashGownPreview
        sashColor={sashColor}
        leftJson={leftJson}
        rightJson={rightJson}
        fontsUsed={fontsUsed}
        readOnly
      />
    </div>
  );
}
