export class ControlCenterHUD {
  private readonly container = document.createElement('div')
  private readonly label = document.createElement('div')

  constructor(parent: HTMLElement) {
    this.container.className = 'cc-hud'
    
    this.label.className = 'cc-hud-label'
    
    const instructions = document.createElement('div')
    instructions.className = 'cc-hud-instructions'
    instructions.innerHTML = `
      <div class="cc-key"><span class="key">Q</span> Previous</div>
      <div class="cc-key"><span class="key">E</span> Next</div>
      <div class="cc-key"><span class="key">F</span> View Details</div>
      <div class="cc-key"><span class="key">ESC</span> Exit</div>
    `

    this.container.appendChild(this.label)
    this.container.appendChild(instructions)
    parent.appendChild(this.container)
  }

  setProjectName(name: string): void {
    this.label.textContent = name
  }

  show(): void {
    this.container.classList.add('visible')
  }

  hide(): void {
    this.container.classList.remove('visible')
  }
}
