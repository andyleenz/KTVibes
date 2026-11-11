import AppKit
import Foundation

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let server = ServerProcess()
    private var stopping = false
    private var readyOutput = ""
    private var openingLogs = false
    private var logsURL: URL { Self.applicationSupportURL.appendingPathComponent("logs/ktvibes.log") }
    private var currentVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    private var releaseURL = URL(string: "https://github.com/JeffShih-wiwynn/KTVibes/releases/latest")!
    private var updateVersion: String?
    private var versionItem: NSMenuItem!
    private var updateTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = Self.makeStatusImage()
        statusItem.button?.toolTip = "KTVibes"
        let menu = NSMenu()
        versionItem = NSMenuItem(title: "", action: #selector(openRelease), keyEquivalent: "")
        versionItem.target = self
        menu.addItem(versionItem)
        menu.addItem(.separator())
        menu.addItem(withTitle: "Open Player", action: #selector(openPlayer), keyEquivalent: "")
        menu.addItem(withTitle: "Show Logs", action: #selector(showLogs), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit", action: #selector(quit), keyEquivalent: "q")
        menu.items.forEach { $0.target = self }
        statusItem.menu = menu
        renderVersionItem()
        startKTVibes()
        updateTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in self?.refreshReleaseInfo() }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !stopping else { return .terminateCancel }
        setStopping(true)
        server.stop { NSApp.reply(toApplicationShouldTerminate: true) }
        return .terminateLater
    }

    private func startKTVibes() {
        guard let resources = Bundle.main.resourceURL, let executable = Bundle.main.executableURL else { return }
        let script = resources.appendingPathComponent("setup-and-run.sh")
        let environment = ProcessInfo.processInfo.environment.merging([
            "KTVIBES_APP_SUPPORT": Self.applicationSupportURL.path,
            "KTVIBES_APP_RESOURCES": resources.path
        ]) { _, new in new }
        server.onOutput = { [weak self] text in
            guard let self else { return }
            self.readyOutput += text
            if self.readyOutput.contains("KTVIBES_SERVER_READY") {
                self.readyOutput = ""
                if !self.stopping { self.openPlayer() }
            }
            self.readyOutput = String(self.readyOutput.suffix(64))
        }
        server.onExit = { [weak self] in
            self?.statusItem.button?.image = NSImage(systemSymbolName: "music.note", accessibilityDescription: "KTVibes stopped")
        }
        do { try server.start(executable: executable, script: script, environment: environment, logURL: logsURL) }
        catch { NSLog("Could not start KTVibes: %@", error.localizedDescription) }
    }

    @objc private func openPlayer() {
        NSWorkspace.shared.open(URL(string: "http://localhost:8765")!)
    }

    @objc private func openRelease() { NSWorkspace.shared.open(releaseURL) }

    private func refreshReleaseInfo() {
        guard !stopping else { return }
        let request = URLRequest(url: URL(string: "http://127.0.0.1:8765/api/config")!, timeoutInterval: 3)
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            guard let data, let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let self else { return }
            DispatchQueue.main.async {
                if let version = payload["version"] as? String { self.currentVersion = version }
                if let update = payload["update"] as? [String: String],
                   let version = update["version"], let url = update["url"], let release = URL(string: url) {
                    self.updateVersion = version
                    self.releaseURL = release
                } else {
                    self.updateVersion = nil
                    self.releaseURL = URL(string: "https://github.com/JeffShih-wiwynn/KTVibes/releases/latest")!
                }
                self.renderVersionItem()
                if payload["update_check_complete"] as? Bool == true {
                    self.updateTimer?.invalidate()
                    self.updateTimer = nil
                }
            }
        }.resume()
    }

    private func renderVersionItem() {
        let latest = updateVersion?.replacingOccurrences(of: "^v", with: "", options: .regularExpression)
        versionItem.title = latest.map { "Version \(currentVersion) → \($0)    ↗" } ?? "Version \(currentVersion)    ↗"
        versionItem.image = updateVersion == nil ? nil : NSImage(systemSymbolName: "arrow.down.to.line", accessibilityDescription: "Update available")
        versionItem.image?.isTemplate = true
    }

    @objc private func showLogs() {
        guard !openingLogs else { return }
        openingLogs = true
        let shellCommand = "tail -n 200 -F '\(logsURL.path.replacingOccurrences(of: "'", with: "'\\''"))'"
        let escaped = shellCommand.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let appleScript = """
        tell application "Terminal"
            activate
            set targetTab to missing value
            repeat with candidateWindow in windows
                repeat with candidateTab in tabs of candidateWindow
                    if custom title of candidateTab is "KTVibes Logs" then set targetTab to candidateTab
                end repeat
            end repeat
            if targetTab is missing value then
                set targetTab to do script "\(escaped)"
                set custom title of targetTab to "KTVibes Logs"
            else
                set index of (window of targetTab) to 1
            end if
        end tell
        """
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        task.arguments = ["-e", appleScript]
        let errorPipe = Pipe()
        task.standardError = errorPipe
        task.terminationHandler = { [weak self] finished in
            let data = errorPipe.fileHandleForReading.readDataToEndOfFile()
            DispatchQueue.main.async {
                self?.openingLogs = false
                if finished.terminationStatus != 0 { self?.showLogError(String(decoding: data, as: UTF8.self)) }
            }
        }
        do { try task.run() }
        catch { openingLogs = false; showLogError(error.localizedDescription) }
    }

    @objc private func quit() { NSApp.terminate(nil) }

    private func setStopping(_ value: Bool) {
        stopping = value
        statusItem.menu?.autoenablesItems = false
        statusItem.menu?.items.forEach { $0.isEnabled = !value }
    }

    private func showLogError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Could not show KTVibes logs"
        alert.informativeText = "Check that Terminal is available, then try again.\n\(message)"
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    private static var applicationSupportURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("KTVibes", isDirectory: true)
    }

    private static func makeStatusImage() -> NSImage {
        let size = NSSize(width: 21, height: 20)
        let image = NSImage(size: size)
        image.lockFocus()
        let font = NSFont.systemFont(ofSize: 15, weight: .semibold)
        let text = NSAttributedString(string: "KT", attributes: [
            .font: font,
            .kern: -0.7,
            .foregroundColor: NSColor.black
        ])
        let bounds = text.boundingRect(
            with: NSSize(width: size.width, height: size.height),
            options: [.usesLineFragmentOrigin, .usesFontLeading]
        )
        let origin = NSPoint(
            x: (size.width - bounds.width) / 2 - bounds.minX,
            y: (size.height - bounds.height) / 2 - bounds.minY
        )
        text.draw(at: origin)
        image.unlockFocus()
        image.isTemplate = true
        return image
    }
}

@main
enum KTVibesLauncher {
    static func main() {
        runServerHelperIfRequested()
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }
}
