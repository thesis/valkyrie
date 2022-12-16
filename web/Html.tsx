import { ServerStyles } from "@mantine/ssr"
import * as React from "react"

export default function Html({
  title,
  renderedChildren,
  stylesServer,
}: {
  title: string
  renderedChildren: string
  stylesServer: any
}) {
  return (
    <html lang="en">
      <head>
        <title>{`Thesis* Valkyrie: ${title}`}</title>
        <ServerStyles html={renderedChildren} server={stylesServer} />
      </head>
      {/* eslint-disable-next-line react/no-danger */}
      <body dangerouslySetInnerHTML={{ __html: renderedChildren }} />
    </html>
  )
}
