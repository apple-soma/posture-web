import './globals.css';

export const metadata = {
  title: 'Posture Check',
  description: '写真から姿勢を測定・評価するWebサービス',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
