import './style.css'
import { AppShell } from './app/AppShell.ts'

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('index.html is missing its #app root element.')

const app = new AppShell(root)
app.start()

// Hot reload: tear the old game down before the new one starts, so an edit never leaves two loops,
// two canvases or doubled keyboard listeners running side by side.
if (import.meta.hot) {
  import.meta.hot.accept()
  import.meta.hot.dispose(() => app.dispose())
}
