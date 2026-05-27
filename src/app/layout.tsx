import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "SceneForge",
  description: "Visual prompt editor for scene building and structured prompt generation.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const stripExtensionHydrationAttributesScript = `
(() => {
  const extensionAttrs = [
    "__gcruniqueid",
    "data-gr-ext-disabled",
    "data-gr-ext-installed",
    "data-new-gr-c-s-check-loaded",
  ];

  const cleanElement = (node) => {
    if (!(node instanceof Element)) {
      return;
    }

    for (const attr of extensionAttrs) {
      node.removeAttribute(attr);
    }

    for (const attr of extensionAttrs) {
      node.querySelectorAll("[" + attr + "]").forEach((element) => {
        element.removeAttribute(attr);
      });
    }
  };

  const cleanDocument = () => {
    cleanElement(document.documentElement);
  };

  cleanDocument();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        cleanElement(mutation.target);
        continue;
      }

      mutation.addedNodes.forEach(cleanElement);
    }
  });

  observer.observe(document.documentElement, {
    attributeFilter: extensionAttrs,
    attributes: true,
    childList: true,
    subtree: true,
  });

  window.addEventListener("DOMContentLoaded", cleanDocument, { once: true });
  window.addEventListener(
    "load",
    () => {
      cleanDocument();
      window.setTimeout(() => observer.disconnect(), 5000);
    },
    { once: true },
  );
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {process.env.NODE_ENV === "development" ? (
          <Script
            id="strip-extension-hydration-attributes"
            strategy="beforeInteractive"
            dangerouslySetInnerHTML={{ __html: stripExtensionHydrationAttributesScript }}
          />
        ) : null}
        {children}
      </body>
    </html>
  );
}
