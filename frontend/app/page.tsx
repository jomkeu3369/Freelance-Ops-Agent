import { publicPageMetadata } from "./lib/site-metadata";
import { homeTitle, homeDescription } from "./lib/site-copy.mjs";
import HomePage from "@/features/home/home-page";
import "@/features/home/styles/figma-home.css";

export const metadata = publicPageMetadata("/", homeTitle, homeDescription);

export default function Page() {
  return <HomePage />;
}
