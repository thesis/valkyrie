import * as React from "react"
import {
  AppShell,
  Header,
  MantineProvider,
  Navbar,
  Text,
  useMantineTheme,
} from "@mantine/core"

type AppProps = {
  children: React.ReactNode
}

function InternalAppShell({ children }: AppProps) {
  const theme = useMantineTheme()

  return (
    <AppShell
      header={
        <Header height={40} p="xs">
          Thesis* Valkyrie
        </Header>
      }
      styles={{
        main: {
          background:
            theme.colorScheme === "dark"
              ? theme.colors.dark[8]
              : theme.colors.gray[0],
        },
      }}
      navbarOffsetBreakpoint="sm"
      asideOffsetBreakpoint="sm"
      /* navbar={
        <Navbar p="md" hiddenBreakpoint="sm" width={{ sm: 200, lg: 300 }}>
          <Text>Application navbar</Text>
        </Navbar>
       } */
    >
      {children}
    </AppShell>
  )
}

export default function App({ children }: AppProps) {
  return (
    <MantineProvider
      theme={{ colorScheme: "light" }}
      withGlobalStyles
      withNormalizeCSS
    >
      <InternalAppShell>{children}</InternalAppShell>
    </MantineProvider>
  )
}
