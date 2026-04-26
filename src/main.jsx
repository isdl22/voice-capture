import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import VoiceCapture from './VoiceCapture.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <VoiceCapture />
  </StrictMode>,
)
