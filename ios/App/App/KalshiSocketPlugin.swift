import Foundation
import Capacitor

/// Hosts the web app and registers this app's own native plugins.
/// Main.storyboard uses this class instead of the stock CAPBridgeViewController.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(KalshiSocketPlugin())
    }
}

/// WebSocket client for Kalshi's live-data API.
///
/// Kalshi authenticates the WebSocket handshake with KALSHI-ACCESS-* headers,
/// and WKWebView's WebSocket can't send custom headers, so the connection is
/// made natively. JavaScript signs the headers (the private key never leaves
/// the web layer) and this plugin only carries bytes.
@objc(KalshiSocketPlugin)
public class KalshiSocketPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionWebSocketDelegate {
    public let identifier = "KalshiSocketPlugin"
    public let jsName = "KalshiSocket"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise)
    ]

    private static let allowedHosts: Set<String> = ["api.elections.kalshi.com", "external-api.kalshi.com", "demo-api.kalshi.co"]

    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    private var sockets: [Int: URLSessionWebSocketTask] = [:]
    private var nextId = 0
    private let lock = NSLock()

    @objc func connect(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"),
              let url = URL(string: urlString),
              url.scheme == "wss",
              let host = url.host,
              KalshiSocketPlugin.allowedHosts.contains(host) else {
            call.reject("Only Kalshi WebSocket URLs are allowed")
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        for (name, value) in call.getObject("headers") ?? [:] {
            if let value = value as? String {
                request.setValue(value, forHTTPHeaderField: name)
            }
        }

        let socket = session.webSocketTask(with: request)
        lock.lock()
        nextId += 1
        let id = nextId
        sockets[id] = socket
        lock.unlock()

        socket.taskDescription = String(id)
        socket.resume()
        receive(on: socket, id: id)
        call.resolve(["id": id])
    }

    @objc func send(_ call: CAPPluginCall) {
        guard let socket = openSocket(for: call), let text = call.getString("data") else {
            call.reject("Socket is not open")
            return
        }
        socket.send(.string(text)) { error in
            if let error = error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        openSocket(for: call)?.cancel(with: .normalClosure, reason: nil)
        call.resolve()
    }

    private func openSocket(for call: CAPPluginCall) -> URLSessionWebSocketTask? {
        guard let id = call.getInt("id") else { return nil }
        lock.lock()
        defer { lock.unlock() }
        return sockets[id]
    }

    private func receive(on socket: URLSessionWebSocketTask, id: Int) {
        socket.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.notifyListeners("message", data: ["id": id, "data": text])
                case .data(let data):
                    self.notifyListeners("message", data: ["id": id, "data": String(decoding: data, as: UTF8.self)])
                @unknown default:
                    break
                }
                self.receive(on: socket, id: id)
            case .failure:
                self.finish(id: id)
            }
        }
    }

    /// Reports a close once per socket, whichever callback notices first.
    private func finish(id: Int) {
        lock.lock()
        let wasOpen = sockets.removeValue(forKey: id) != nil
        lock.unlock()
        if wasOpen {
            notifyListeners("close", data: ["id": id])
        }
    }

    private func socketId(_ task: URLSessionTask) -> Int? {
        return Int(task.taskDescription ?? "")
    }

    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol negotiatedProtocol: String?) {
        if let id = socketId(webSocketTask) {
            notifyListeners("open", data: ["id": id])
        }
    }

    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        if let id = socketId(webSocketTask) {
            finish(id: id)
        }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let id = socketId(task) {
            finish(id: id)
        }
    }
}
