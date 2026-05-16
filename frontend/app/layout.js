import './globals.css'

export const metadata = {
  title: 'Free Temp Mail',
  description: 'A disposable email service',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
