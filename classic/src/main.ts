import './style.css'
import { Game } from './core/Game.ts'

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('index.html is missing its #app root element.')

const game = new Game(root)
game.start()

// Hot reload: tear the old game down before the new one starts, so an edit never leaves two loops,
// two canvases or doubled keyboard listeners running side by side.
if (import.meta.hot) {
  import.meta.hot.accept()
  import.meta.hot.dispose(() => game.dispose())
}
