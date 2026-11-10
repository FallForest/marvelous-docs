import React from 'react'
import ReactDOM from 'react-dom/client'
import { AppRoot } from './App'
import ErrorBoundary from './components/ui/ErrorBoundary'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary><AppRoot /></ErrorBoundary></React.StrictMode>,
)
