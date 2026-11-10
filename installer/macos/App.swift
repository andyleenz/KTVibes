import AppKit
import Foundation

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var statusLabel: NSTextField!
    private var outputView: NSTextView!
    private var actionButton: NSButton!
    private var process: Process?
    private var outputHandle: FileHandle?

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildWindow()
        NSApp.activate(ignoringOtherApps: true)
        startKTVibes()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        process?.terminate()
    }

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 620, height: 390),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "KTVibes"
        window.center()

        let root = NSStackView()
        root.orientation = .vertical
        root.alignment = .leading
        root.spacing = 14
        root.translatesAutoresizingMaskIntoConstraints = false

        let title = NSTextField(labelWithString: "KTVibes for Apple silicon")
        title.font = .systemFont(ofSize: 22, weight: .semibold)
        statusLabel = NSTextField(wrappingLabelWithString: "Preparing KTVibes. First setup downloads its runtime and packages.")
        statusLabel.font = .systemFont(ofSize: 13)

        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        outputView = NSTextView()
        outputView.isEditable = false
        outputView.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        scroll.documentView = outputView
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.heightAnchor.constraint(equalToConstant: 190).isActive = true

        actionButton = NSButton(title: "Start KTVibes", target: self, action: #selector(startKTVibes))
        actionButton.bezelStyle = .rounded
        actionButton.isEnabled = false

        root.addArrangedSubview(title)
        root.addArrangedSubview(statusLabel)
        root.addArrangedSubview(scroll)
        root.addArrangedSubview(actionButton)
        window.contentView = NSView()
        window.contentView?.addSubview(root)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 22),
            root.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -22),
            root.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 22),
            root.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor, constant: -22),
            scroll.widthAnchor.constraint(equalTo: root.widthAnchor)
        ])
        window.makeKeyAndOrderFront(nil)
    }

    @objc private func startKTVibes() {
        guard process == nil else { return }
        guard let script = Bundle.main.resourceURL?.appendingPathComponent("setup-and-run.sh") else {
            statusLabel.stringValue = "The setup script is missing from this app. Reinstall KTVibes."
            return
        }
        actionButton.isEnabled = false
        statusLabel.stringValue = "Setting up KTVibes and starting the local server…"

        let child = Process()
        child.executableURL = URL(fileURLWithPath: "/bin/bash")
        child.arguments = [script.path]
        child.environment = ProcessInfo.processInfo.environment.merging([
            "KTVIBES_APP_SUPPORT": Self.applicationSupportURL.path,
            "KTVIBES_APP_RESOURCES": Bundle.main.resourceURL!.path
        ]) { _, new in new }

        let pipe = Pipe()
        child.standardOutput = pipe
        child.standardError = pipe
        outputHandle = pipe.fileHandleForReading
        outputHandle?.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            let text = String(decoding: data, as: UTF8.self)
            DispatchQueue.main.async { self?.appendOutput(text) }
        }
        child.terminationHandler = { [weak self] finished in
            DispatchQueue.main.async {
                guard let self else { return }
                self.outputHandle?.readabilityHandler = nil
                self.process = nil
                self.actionButton.isEnabled = true
                self.statusLabel.stringValue = finished.terminationStatus == 0
                    ? "KTVibes stopped. Select Start KTVibes to run it again."
                    : "Setup or startup failed. See the log above, then select Start KTVibes to retry."
            }
        }
        do {
            try child.run()
            process = child
        } catch {
            statusLabel.stringValue = "Could not start KTVibes: \(error.localizedDescription)"
            actionButton.isEnabled = true
        }
    }

    private func appendOutput(_ text: String) {
        outputView.textStorage?.append(NSAttributedString(string: text))
        outputView.scrollToEndOfDocument(nil)
        if text.contains("KTVIBES_SERVER_READY") {
            statusLabel.stringValue = "KTVibes is running. Your browser is opening to the local TV screen."
            NSWorkspace.shared.open(URL(string: "http://localhost:8765")!)
        }
    }

    private static var applicationSupportURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("KTVibes", isDirectory: true)
    }
}

@main
enum KTVibesLauncher {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}
