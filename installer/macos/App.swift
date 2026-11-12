import AppKit
import Foundation
import ServiceManagement
import Darwin

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
    private var loginItem: NSMenuItem!
    private var network = NetworkPreferences.load()
    private var networkWindow: NetworkWindow?
    private var instanceID = UUID().uuidString
    private var changingNetwork = false
    private var activePort: Int?
    private var portConflict = false

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
        menu.addItem(withTitle: "Network Settings…", action: #selector(showNetworkSettings), keyEquivalent: "")
        menu.addItem(.separator())
        loginItem = NSMenuItem(title: "Launch at Login", action: #selector(toggleLaunchAtLogin), keyEquivalent: "")
        menu.addItem(loginItem)
        refreshLoginItemState()
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
        guard !stopping else { return }
        guard let resources = Bundle.main.resourceURL, let executable = Bundle.main.executableURL else { return }
        let script = resources.appendingPathComponent("setup-and-run.sh")
        var environment = ProcessInfo.processInfo.environment.merging([
            "KTVIBES_APP_SUPPORT": Self.applicationSupportURL.path,
            "KTVIBES_APP_RESOURCES": resources.path
        ]) { _, new in new }
        environment["KTVIBES_PORT"] = String(network.port)
        environment["KTVIBES_AUTO_PORT"] = "1"
        environment["KTVIBES_PORT_FILE"] = Self.applicationSupportURL.appendingPathComponent("active-port").path
        environment["KTVIBES_ADVERTISE_IP"] = network.ip
        environment.removeValue(forKey: "KTVIBES_REMOTE_URL")
        instanceID = UUID().uuidString
        activePort = nil
        portConflict = false
        try? FileManager.default.removeItem(at: Self.applicationSupportURL.appendingPathComponent("active-port"))
        environment["KTVIBES_INSTANCE_ID"] = instanceID
        server.onOutput = { [weak self] text in
            guard let self else { return }
            self.readyOutput += text
            for line in text.components(separatedBy: .newlines) {
                if line.hasPrefix("KTVIBES_ACTIVE_PORT="), let port = Int(line.dropFirst("KTVIBES_ACTIVE_PORT=".count)) { self.activePort = port }
                if line.contains("KTVIBES_PORT_CONFLICT") { self.portConflict = true; self.renderVersionItem() }
            }
            if self.readyOutput.contains("KTVIBES_SERVER_READY") {
                self.readyOutput = ""
                // The menu bar app starts the server in the background. Users open the player explicitly.
            }
            self.readyOutput = String(self.readyOutput.suffix(64))
        }
        server.onExit = { [weak self] in
            self?.statusItem.button?.image = Self.makeStatusImage(stopped: true)
            self?.renderVersionItem()
        }
        do { try server.start(executable: executable, script: script, environment: environment, logURL: logsURL) }
        catch { NSLog("Could not start KTVibes: %@", error.localizedDescription) }
    }

    @objc private func openPlayer() {
        readActivePort()
        NSWorkspace.shared.open(URL(string: "http://localhost:\(activePort ?? network.port)")!)
    }

    private func readActivePort() {
        if let value = try? String(contentsOf: Self.applicationSupportURL.appendingPathComponent("active-port"), encoding: .ascii), let port = Int(value.trimmingCharacters(in: .whitespacesAndNewlines)) { activePort = port }
    }

    @objc private func showNetworkSettings() {
        readActivePort()
        if networkWindow == nil {
            networkWindow = NetworkWindow()
            networkWindow?.apply = { [weak self] preferences in self?.applyNetwork(preferences) }
        }
        networkWindow?.present(network, activePort: activePort, conflict: portConflict)
    }

    private func applyNetwork(_ next: NetworkPreferences) {
        guard !changingNetwork, next != network || portConflict else { return }
        let previous = network
        changingNetwork = true
        networkWindow?.busy(true, message: "Restarting…")
        server.stop { [weak self] in
            guard let self else { return }
            self.network = next
            self.startKTVibes()
            self.waitForNetwork(attempts: 150) { success in
                if success {
                    do {
                        try next.save()
                        self.changingNetwork = false
                        self.statusItem.button?.image = Self.makeStatusImage()
                        self.networkWindow?.busy(false, message: "Available")
                        self.networkWindow?.present(next, activePort: self.activePort, conflict: false)
                        self.openPlayer()
                    } catch { self.restoreNetwork(previous, reason: "Could not save settings: \(error.localizedDescription)") }
                } else { self.restoreNetwork(previous, reason: "The new server could not start. The port may be in use. Restoring previous settings…") }
            }
        }
    }

    private func restoreNetwork(_ previous: NetworkPreferences, reason: String) {
        networkWindow?.busy(true, message: reason)
        server.stop { [weak self] in
            guard let self else { return }
            self.network = previous
            self.startKTVibes()
            self.waitForNetwork(attempts: 150) { success in
                self.changingNetwork = false
                if success { self.statusItem.button?.image = Self.makeStatusImage() }
                self.networkWindow?.busy(false, message: success ? "Previous settings restored. Check the port and try again." : "Server unavailable. Open Show Logs for details.")
            }
        }
    }

    private func waitForNetwork(attempts: Int, completion: @escaping (Bool) -> Void) {
        guard !stopping, attempts > 0 else { completion(false); return }
        readActivePort()
        let request = URLRequest(url: URL(string: "http://127.0.0.1:\(activePort ?? network.port)/api/config")!, timeoutInterval: 1)
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                let config = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                if config?["instance_id"] as? String == self.instanceID { completion(true) }
                else { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.waitForNetwork(attempts: attempts - 1, completion: completion) } }
            }
        }.resume()
    }

    @objc private func openRelease() {
        if portConflict { showNetworkSettings() } else { NSWorkspace.shared.open(releaseURL) }
    }

    @objc private func toggleLaunchAtLogin() {
        let service = SMAppService.mainApp
        do {
            if service.status == .enabled {
                try service.unregister()
            } else {
                try service.register()
            }
        } catch {
            SMAppService.openSystemSettingsLoginItems()
        }
        refreshLoginItemState()
    }

    private func refreshLoginItemState() {
        loginItem?.state = SMAppService.mainApp.status == .enabled ? .on : .off
    }

    private func refreshReleaseInfo() {
        guard !stopping else { return }
        readActivePort()
        let request = URLRequest(url: URL(string: "http://127.0.0.1:\(activePort ?? network.port)/api/config")!, timeoutInterval: 3)
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
        guard let data, let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let self else { return }
            DispatchQueue.main.async {
                guard payload["instance_id"] as? String == self.instanceID else { return }
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
        if portConflict { versionItem.title = "Port conflict"; versionItem.image = nil; return }
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

    private static func makeStatusImage(stopped: Bool = false) -> NSImage {
        let size = NSSize(width: 24, height: 20)
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
        if stopped {
            let slash = NSBezierPath()
            slash.lineCapStyle = .round
            slash.move(to: NSPoint(x: 5, y: 3))
            slash.line(to: NSPoint(x: 19, y: 17))
            // A transparent gap keeps the slash distinct in both menu bar appearances.
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current?.compositingOperation = .clear
            slash.lineWidth = 4
            slash.stroke()
            NSGraphicsContext.restoreGraphicsState()
            NSColor.black.setStroke()
            slash.lineWidth = 1.5
            slash.stroke()
        }
        image.unlockFocus()
        image.isTemplate = true
        return image
    }
}

struct NetworkPreferences: Codable, Equatable {
    var ip: String = ""
    var port: Int = 8765
    static var file: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("KTVibes/network.json")
    }
    static func load() -> Self {
        if let data = try? Data(contentsOf: file), let value = try? JSONDecoder().decode(Self.self, from: data), (1...65535).contains(value.port) { return value }
        return Self(ip: ProcessInfo.processInfo.environment["KTVIBES_ADVERTISE_IP"] ?? "", port: Int(ProcessInfo.processInfo.environment["KTVIBES_PORT"] ?? "8765").flatMap { (1...65535).contains($0) ? $0 : nil } ?? 8765)
    }
    func save() throws {
        try FileManager.default.createDirectory(at: Self.file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(self).write(to: Self.file, options: .atomic)
    }
}

final class NetworkWindow: NSObject, NSWindowDelegate {
    var apply: ((NetworkPreferences) -> Void)?
    private let window = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 480, height: 88), styleMask: [.titled, .closable], backing: .buffered, defer: false)
    private let status = NSTextField(wrappingLabelWithString: "Connecting…")
    private let address = NSTextField(labelWithString: "")
    private let networks = NSPopUpButton()
    private let port = NSTextField(string: "8765")
    private let portBackground = NSView()
    private let advanced = NSStackView()
    private let disclosure = NSButton(checkboxWithTitle: "Advanced settings", target: nil, action: nil)
    private let buttons = NSStackView()
    private let hint = NSTextField(labelWithString: "Applying changes will restart the server.")
    private var displayedPort = 8765
    private var ips = [""]
    private var timer: Timer?
    private var current = NetworkPreferences()
    private var saving = false
    private let applyButton = NSButton(title: "Apply", target: nil, action: nil)
    private let resetButton = NSButton(title: "Reset", target: nil, action: nil)

    override init() {
        super.init()
        window.title = "Network Settings"; window.delegate = self; window.isReleasedWhenClosed = false
        address.isSelectable = true
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        let copy = NSButton(title: "", target: self, action: #selector(copyAddress))
        copy.image = NSImage(systemSymbolName: "doc.on.doc", accessibilityDescription: "Copy address")
        copy.imagePosition = .imageOnly
        copy.isBordered = false
        copy.toolTip = "Copy address"
        copy.setAccessibilityLabel("Copy address")
        copy.widthAnchor.constraint(equalToConstant: 28).isActive = true
        let addressLabel = NSTextField(labelWithString: "Remote address")
        addressLabel.widthAnchor.constraint(equalToConstant: 105).isActive = true
        address.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let urlRow = NSStackView(views: [addressLabel, address, copy]); urlRow.spacing = 10
        urlRow.widthAnchor.constraint(equalToConstant: 440).isActive = true
        disclosure.target = self; disclosure.action = #selector(toggleAdvanced(_:))
        networks.widthAnchor.constraint(equalToConstant: 350).isActive = true
        portBackground.wantsLayer = true
        portBackground.layer?.cornerRadius = 7
        portBackground.layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        portBackground.layer?.borderWidth = 1
        portBackground.layer?.borderColor = NSColor.separatorColor.cgColor
        portBackground.translatesAutoresizingMaskIntoConstraints = false
        portBackground.widthAnchor.constraint(equalToConstant: 350).isActive = true
        portBackground.heightAnchor.constraint(equalToConstant: 28).isActive = true
        port.isBordered = false
        port.drawsBackground = false
        port.focusRingType = .none
        port.translatesAutoresizingMaskIntoConstraints = false
        portBackground.addSubview(port)
        NSLayoutConstraint.activate([
            port.leadingAnchor.constraint(equalTo: portBackground.leadingAnchor, constant: 10),
            port.trailingAnchor.constraint(equalTo: portBackground.trailingAnchor, constant: -10),
            port.centerYAnchor.constraint(equalTo: portBackground.centerYAnchor)
        ])
        let networkLabel = NSTextField(labelWithString: "Network")
        let portLabel = NSTextField(labelWithString: "Port")
        for label in [networkLabel, portLabel] { label.widthAnchor.constraint(equalToConstant: 74).isActive = true }
        let networkRow = NSStackView(views: [networkLabel, networks]); networkRow.spacing = 16
        let portRow = NSStackView(views: [portLabel, portBackground]); portRow.spacing = 16
        advanced.orientation = .vertical; advanced.alignment = .leading; advanced.spacing = 12
        hint.textColor = .secondaryLabelColor
        for view in [networkRow, portRow, hint] { advanced.addArrangedSubview(view) }
        advanced.isHidden = true
        applyButton.target = self; applyButton.action = #selector(save)
        applyButton.bezelStyle = .rounded
        applyButton.bezelColor = .controlAccentColor
        applyButton.contentTintColor = .white
        applyButton.keyEquivalent = "\r"
        resetButton.target = self; resetButton.action = #selector(reset)
        let spacer = NSView()
        for view in [resetButton, spacer, applyButton] { buttons.addArrangedSubview(view) }
        buttons.spacing = 10; buttons.isHidden = true
        buttons.widthAnchor.constraint(equalToConstant: 440).isActive = true
        status.isHidden = true
        for view in [urlRow, status, disclosure, advanced, buttons] { stack.addArrangedSubview(view) }
        let container = NSView()
        container.addSubview(stack)
        window.contentView = container
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: container.topAnchor, constant: 18)
        ])
        window.center()
    }
    func present(_ preferences: NetworkPreferences, activePort: Int?, conflict: Bool) {
        current = preferences; port.stringValue = String(preferences.port)
        displayedPort = activePort ?? preferences.port
        networks.removeAllItems(); networks.addItem(withTitle: "Automatic"); ips = [""]
        var entries: UnsafeMutablePointer<ifaddrs>?
        if getifaddrs(&entries) == 0 {
            var cursor = entries
            while let entry = cursor {
                defer { cursor = entry.pointee.ifa_next }
                guard let addr = entry.pointee.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET), entry.pointee.ifa_flags & UInt32(IFF_UP) != 0, entry.pointee.ifa_flags & UInt32(IFF_LOOPBACK) == 0 else { continue }
                var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                if getnameinfo(addr, socklen_t(addr.pointee.sa_len), &buffer, socklen_t(buffer.count), nil, 0, NI_NUMERICHOST) == 0 {
                    let ip = String(cString: buffer)
                    ips.append(ip); networks.addItem(withTitle: "\(String(cString: entry.pointee.ifa_name)) — \(ip)")
                }
            }
            freeifaddrs(entries)
        }
        if !ips.contains(preferences.ip) { ips.append(preferences.ip); networks.addItem(withTitle: "Unavailable — \(preferences.ip)") }
        networks.selectItem(at: ips.firstIndex(of: preferences.ip) ?? 0)
        if conflict {
            disclosure.state = .on; advanced.isHidden = false; buttons.isHidden = false
            window.setContentSize(NSSize(width: 480, height: 225))
            hint.stringValue = "These ports are in use. Choose another port."
            hint.textColor = .systemRed
            portBackground.layer?.borderWidth = 1.5
            portBackground.layer?.borderColor = NSColor.systemRed.cgColor
        } else {
            portBackground.layer?.borderWidth = 1
            portBackground.layer?.borderColor = NSColor.separatorColor.cgColor
            hint.stringValue = "Applying changes will restart the server."
            hint.textColor = .secondaryLabelColor
        }
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        timer?.invalidate(); refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.refresh() }
    }
    func busy(_ value: Bool, message: String) {
        saving = value; status.stringValue = message
        status.isHidden = message == "Restarting…" || (!value && message == "Available")
        applyButton.title = value ? "Restarting…" : "Apply"
        applyButton.isEnabled = !value; resetButton.isEnabled = !value; networks.isEnabled = !value; port.isEnabled = !value
    }
    private func refresh() {
        guard !saving else { return }
        let request = URLRequest(url: URL(string: "http://127.0.0.1:\(displayedPort)/api/config")!, timeoutInterval: 2)
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            DispatchQueue.main.async {
                guard let self, !self.saving else { return }
                let config = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                self.address.stringValue = config?["remote_url"] as? String ?? "Unavailable"
                if config != nil { self.status.isHidden = true }
                else if self.status.stringValue == "Connecting…" { self.status.stringValue = "Server unavailable."; self.status.isHidden = false }
            }
        }.resume()
    }
    @objc private func save() {
        guard let number = Int(port.stringValue), (1...65535).contains(number) else { status.stringValue = "Port must be a number from 1 to 65535."; status.isHidden = false; return }
        apply?(NetworkPreferences(ip: ips[max(0, networks.indexOfSelectedItem)], port: number))
    }
    @objc private func reset() { networks.selectItem(at: 0); port.stringValue = "8765" }
    @objc private func copyAddress() { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(address.stringValue, forType: .string) }
    @objc private func toggleAdvanced(_ sender: NSButton) { advanced.isHidden = sender.state != .on; buttons.isHidden = advanced.isHidden; window.setContentSize(NSSize(width: 480, height: sender.state == .on ? 225 : 88)) }
    @objc private func closeWindow() { window.close() }
    func windowWillClose(_ notification: Notification) { timer?.invalidate(); timer = nil }
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
