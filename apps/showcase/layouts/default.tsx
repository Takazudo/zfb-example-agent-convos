import type { Child } from '@takazudo/zfb/zudo-react';
export default function Layout({ children }: {
    children: Child;
}) {
    return <html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>Agent conversations · zfb recipe</title><link rel="stylesheet" href="/convos.css"/></head>
    <body>{children}<noscript>The interactive conversation example requires JavaScript.</noscript></body></html>;
}
