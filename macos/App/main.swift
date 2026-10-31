import Cocoa
import WebKit
import ServiceManagement

// Storage — a thin native shell around the local dashboard server.
//  • starts the bundled Node server (or reuses one that is already running)
//  • shows the UI in a native window; closing the window keeps the app in the menu bar
//  • menu bar item shows free space and quick actions

let port = 4747
let baseURL = URL(string: "http://127.0.0.1:\(port)")!

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var statusItem: NSStatusItem!
    var infoItem = NSMenuItem(title: "Loading…", action: nil, keyEquivalent: "")
    var detailItem = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    var loginItem = NSMenuItem(title: "Launch at Login", action: #selector(toggleLogin), keyEquivalent: "")
    var updateItem = NSMenuItem(title: "Update available — Restart to update", action: #selector(openSettings), keyEquivalent: "")
    var server: Process?
    var timer: Timer?

    // MARK: lifecycle
    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMainMenu()
        startServerIfNeeded()
        buildWindow()
        buildStatusItem()
        waitForServer(attempts: 60) { [self] up in
            if up { web.load(URLRequest(url: baseURL)); refreshStatus() }
            else { showError("The Storage server did not start.\n\nMake sure Node.js is installed (https://nodejs.org) and try again.") }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.refreshStatus() }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showWindow(); return true }
    func applicationWillTerminate(_ notification: Notification) { server?.terminate() }
    func windowShouldClose(_ sender: NSWindow) -> Bool { sender.orderOut(nil); return false }

    // MARK: server
    func isUp() -> Bool {
        var up = false; let sem = DispatchSemaphore(value: 0)
        var req = URLRequest(url: baseURL.appendingPathComponent("api/status")); req.timeoutInterval = 1
        URLSession.shared.dataTask(with: req) { _, resp, _ in up = (resp as? HTTPURLResponse)?.statusCode == 200; sem.signal() }.resume()
        _ = sem.wait(timeout: .now() + 1.5); return up
    }
    func findNode() -> String? {
        let home = NSHomeDirectory()
        let candidates = ["\(home)/.local/bin/node", "/opt/homebrew/bin/node", "/usr/local/bin/node", "\(home)/.volta/bin/node", "/usr/bin/node"]
        if let c = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) { return c }
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/bin/zsh"); p.arguments = ["-lc", "command -v node"]
        let pipe = Pipe(); p.standardOutput = pipe; p.standardError = Pipe()
        try? p.run(); p.waitUntilExit()
        let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return out.isEmpty ? nil : out
    }
    func startServerIfNeeded() {
        if isUp() { return }
        guard let node = findNode() else { showError("Node.js was not found.\n\nInstall it from https://nodejs.org and open Storage again."); return }
        guard let script = Bundle.main.resourceURL?.appendingPathComponent("server/server.js").path else { return }
        let data = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Storage Dashboard").path
        try? FileManager.default.createDirectory(atPath: data, withIntermediateDirectories: true)
        let p = Process(); p.executableURL = URL(fileURLWithPath: node); p.arguments = [script]
        var env = ProcessInfo.processInfo.environment; env["STORAGE_DATA"] = data; env["STORAGE_APP_PATH"] = Bundle.main.bundlePath
        env["PATH"] = "\(NSHomeDirectory())/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        p.environment = env
        p.standardOutput = FileHandle(forWritingAtPath: "/dev/null"); p.standardError = FileHandle(forWritingAtPath: "/dev/null")
        do { try p.run(); server = p } catch { showError("Could not start the server: \(error.localizedDescription)") }
    }
    func waitForServer(attempts: Int, done: @escaping (Bool) -> Void) {
        DispatchQueue.global().async {
            for _ in 0..<attempts { if self.isUp() { DispatchQueue.main.async { done(true) }; return }; Thread.sleep(forTimeInterval: 0.3) }
            DispatchQueue.main.async { done(false) }
        }
    }
    func fetchToken(_ done: @escaping (String?) -> Void) {
        URLSession.shared.dataTask(with: baseURL) { data, _, _ in
            guard let d = data, let s = String(data: d, encoding: .utf8),
                  let r = s.range(of: #"__TOKEN__ = "([0-9a-f]{32})""#, options: .regularExpression) else { done(nil); return }
            done(String(s[r].dropFirst(14).dropLast(1)).trimmingCharacters(in: CharacterSet(charactersIn: "\" =")))
        }.resume()
    }

    // MARK: window
    func buildWindow() {
        let cfg = WKWebViewConfiguration()
        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self; web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 880),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.title = "Storage"; window.titlebarAppearsTransparent = true; window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true; window.minSize = NSSize(width: 900, height: 600)
        window.contentView = web; window.delegate = self; window.center()
        window.setFrameAutosaveName("StorageMain")
    }
    func showWindow() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    func showError(_ msg: String) { let a = NSAlert(); a.messageText = "Storage"; a.informativeText = msg; a.runModal() }

    // keep the dashboard inside the window; everything else opens in the browser
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = action.request.url, u.host != "127.0.0.1", u.scheme == "http" || u.scheme == "https" { NSWorkspace.shared.open(u); decisionHandler(.cancel) } else { decisionHandler(.allow) }
    }
    func webView(_ webView: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = a.request.url { NSWorkspace.shared.open(u) }; return nil
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { webView.load(URLRequest(url: baseURL)) }
    }

    // MARK: menu bar
    func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let b = statusItem.button { b.image = NSImage(systemSymbolName: "internaldrive", accessibilityDescription: "Storage"); b.imagePosition = .imageLeading; b.title = "" }
        let m = NSMenu()
        infoItem.isEnabled = false; detailItem.isEnabled = false
        updateItem.target = self; updateItem.isHidden = true
        m.addItem(infoItem); m.addItem(detailItem); m.addItem(updateItem); m.addItem(.separator())
        m.addItem(withTitle: "Open Storage", action: #selector(openApp), keyEquivalent: "o").target = self
        m.addItem(withTitle: "Rescan Now", action: #selector(rescan), keyEquivalent: "r").target = self
        m.addItem(withTitle: "Open in Browser", action: #selector(openBrowser), keyEquivalent: "").target = self
        m.addItem(.separator())
        loginItem.target = self; loginItem.action = #selector(toggleLogin); m.addItem(loginItem)
        m.addItem(.separator())
        m.addItem(withTitle: "Quit Storage", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = m
        updateLoginState()
    }
    func refreshStatus() {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/widget")); req.timeoutInterval = 3
        URLSession.shared.dataTask(with: req) { data, _, _ in
            guard let d = data, let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                  let free = j["free"] as? Double, let total = j["total"] as? Double else { return }
            let safe = (j["safeKB"] as? Double ?? 0) * 1024, tasks = j["openTasks"] as? Int ?? 0
            let update = j["update"] as? [String: Any], newVersion = update?["version"] as? String, notice = j["notice"] as? String
            DispatchQueue.main.async {
                let gb = { (b: Double) in String(format: b >= 1e11 ? "%.0f GB" : "%.1f GB", b / 1e9) }
                self.statusItem.button?.title = " " + gb(free)
                self.infoItem.title = "\(gb(free)) free of \(gb(total))"
                self.detailItem.title = "\(gb(safe)) safe to clean · \(tasks) task\(tasks == 1 ? "" : "s")"
                self.applyUpdateState(version: newVersion, notice: notice)
            }
        }.resume()
    }
    // Update badge: menu item + Dock badge + one macOS notification per new version / notice.
    func applyUpdateState(version: String?, notice: String?) {
        updateItem.isHidden = version == nil
        if let v = version { updateItem.title = "Update to \(v) — Restart to update" }
        NSApp.dockTile.badgeLabel = version != nil ? "1" : nil
        let d = UserDefaults.standard
        if let v = version, d.string(forKey: "notifiedVersion") != v { d.set(v, forKey: "notifiedVersion"); notify("Storage \(v) is available", "Open Storage and choose Restart to update.") }
        if let n = notice, d.string(forKey: "notifiedNotice") != n { d.set(n, forKey: "notifiedNotice"); notify("Storage", n) }
    }
    func notify(_ title: String, _ body: String) {
        let esc = { (s: String) in s.replacingOccurrences(of: "\\", with: "").replacingOccurrences(of: "\"", with: "'") }
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        p.arguments = ["-e", "display notification \"\(esc(body))\" with title \"\(esc(title))\""]
        try? p.run()
    }
    @objc func openSettings() { showWindow(); web.evaluateJavaScript("go('settings')", completionHandler: nil) }
    @objc func openApp() { showWindow() }
    @objc func openBrowser() { NSWorkspace.shared.open(baseURL) }
    @objc func rescan() {
        fetchToken { token in
            guard let t = token else { return }
            var req = URLRequest(url: baseURL.appendingPathComponent("api/scan")); req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "content-type"); req.setValue(t, forHTTPHeaderField: "x-token"); req.httpBody = Data("{}".utf8)
            URLSession.shared.dataTask(with: req) { _, _, _ in DispatchQueue.main.async { self.web.reload() } }.resume()
        }
    }
    @objc func toggleLogin() {
        do { if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() } } catch { showError("Could not change the login item: \(error.localizedDescription)") }
        updateLoginState()
    }
    func updateLoginState() { loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off }

    // MARK: main menu (copy/paste, reload, quit)
    func buildMainMenu() {
        let main = NSMenu()
        let app = NSMenuItem(); main.addItem(app); let appMenu = NSMenu(); app.submenu = appMenu
        appMenu.addItem(withTitle: "About Storage", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Storage", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Storage", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let edit = NSMenuItem(); main.addItem(edit); let em = NSMenu(title: "Edit"); edit.submenu = em
        em.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        em.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        let view = NSMenuItem(); main.addItem(view); let vm = NSMenu(title: "View"); view.submenu = vm
        let reload = vm.addItem(withTitle: "Reload", action: #selector(reloadPage), keyEquivalent: "r"); reload.target = self
        let win = NSMenuItem(); main.addItem(win); let wm = NSMenu(title: "Window"); win.submenu = wm
        wm.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        wm.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        NSApp.mainMenu = main
    }
    @objc func reloadPage() { web.reload() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
