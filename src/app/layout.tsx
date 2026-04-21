import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "YouTube Study Tool",
  description:
    "A YouTube-based AI learning app that turns transcripts into notes, quizzes, and transcript-grounded Q&A."
};

const themeBootScript = `
(() => {
  const savedTheme = window.localStorage.getItem("turbo-cloud-chat-theme");
  if (savedTheme && savedTheme !== "system") {
    document.documentElement.dataset.theme = savedTheme;
  } else {
    delete document.documentElement.dataset.theme;
  }
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="app-shell">
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        {children}
      </body>
    </html>
  );
}
