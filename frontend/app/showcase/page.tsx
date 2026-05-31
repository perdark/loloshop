import type { Metadata } from "next";
import Showcase from "./Showcase";

export const metadata: Metadata = {
  title: "باقة التخرّج المتكاملة | LoloShop",
  description: "روب وشاح وقبّعة — صمّم وشاحك بنفسك. باقة تخرّج فاخرة من لولو شوب.",
};

export default function ShowcasePage() {
  return <Showcase />;
}
