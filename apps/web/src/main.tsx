import React from 'react'
import ReactDOM from 'react-dom/client'
import { AppRoot } from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary><AppRoot /></ErrorBoundary></React.StrictMode>,
)
