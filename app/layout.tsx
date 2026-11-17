import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getSeasonAvatarItemById } from "./lib/avatarItems";
import { getCurrentSeasonConfig } from "./lib/seasons";
import GlobalNotifications from "./components/GlobalNotifications";
import PollModal from "./components/PollModal";
import GiftNotifications from "./components/GiftNotifications";
import EventOverlay from "./components/EventOverlay";
import ClientProviders from "./components/ClientProviders";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Favicon is the current season's featured avatar piece, resolved at build time.
const seasonIcon = (() => {
  const featuredId = getCurrentSeasonConfig()?.featuredAvatarItemId;
  return featuredId ? getSeasonAvatarItemById(featuredId)?.previewImageUrl : undefined;
})();

export const metadata: Metadata = {
  title: "Michael's Drop Game",
  description: "Survive the rising platforms!",
  icons: seasonIcon
    ? { icon: [{ url: seasonIcon, type: "image/svg+xml" }] }
    : undefined,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ClientProviders>
          {children}
          <GlobalNotifications />
          <GiftNotifications />
          <PollModal />
          <EventOverlay />
        </ClientProviders>
      </body>
    </html>
  );
}
