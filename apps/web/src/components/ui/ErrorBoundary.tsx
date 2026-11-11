import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'

type ErrorBoundaryProps = { children: ReactNode }
type ErrorBoundaryState = { error: Error | null }

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env?.DEV) console.error('界面渲染出错：', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <div className="error-screen" role="alert">
      {/* The recovery screen is the last thing a broken render shows, so it
          arrives with the same entrance as any other surface instead of
          snapping into place behind a blank frame. */}
      <div className="error-card motion-sheet">
        <div className="error-icon"><AlertCircle size={20} /></div>
        <h1>界面出现异常</h1>
        <p>刚才的操作没有完成。重新加载页面可以恢复工作区，未同步的内容可能需要在历史版本中找回。</p>
        <pre>{this.state.error.message}</pre>
        <div className="error-actions">
          <button className="secondary-btn" onClick={() => this.setState({ error: null })}>重试</button>
          <button className="primary-btn" onClick={() => window.location.reload()}>重新加载</button>
        </div>
      </div>
    </div>
  }
}
