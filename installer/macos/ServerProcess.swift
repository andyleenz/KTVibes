import Darwin
import Foundation

// The helper execs bash in its own process group. Signals never target the app,
// Terminal, or another KTVibes instance.
func runServerHelperIfRequested() {
    guard CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--run-server" else { return }
    guard setpgid(0, 0) == 0 else { exit(1) }
    CommandLine.arguments[2].withCString { scriptPath in
        "/bin/bash".withCString { bashPath in
            var arguments: [UnsafeMutablePointer<CChar>?] = [strdup(bashPath), strdup(scriptPath), nil]
            _ = execv(bashPath, &arguments)
        }
    }
    exit(1)
}

// All state changes and callbacks run on the main queue; pipe reads remain active
// on Foundation's reader queue throughout shutdown.
final class ServerProcess {
    var onOutput: ((String) -> Void)?
    var onExit: (() -> Void)?
    private var child: Process?
    private var output: FileHandle?
    private var timer: DispatchSourceTimer?
    private var completions: [() -> Void] = []
    private var deadline = DispatchTime.now()
    private var forced = false
    private var group: pid_t = 0
    private var log: RotatingLog?

    func start(executable: URL, script: URL, environment: [String: String], logURL: URL) throws {
        let process = Process()
        process.executableURL = executable
        process.arguments = ["--run-server", script.path]
        process.environment = environment
        let pipe = Pipe()
        let rotatingLog = try RotatingLog(url: logURL)
        log = rotatingLog
        process.standardOutput = pipe
        process.standardError = pipe
        output = pipe.fileHandleForReading
        output?.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            let text = String(decoding: data, as: UTF8.self)
            do { try rotatingLog.write(data) }
            catch { NSLog("Could not write KTVibes log: %@", error.localizedDescription) }
            DispatchQueue.main.async { self?.onOutput?(text) }
        }
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async { self?.stop {} }
        }
        do { try process.run() }
        catch {
            output?.readabilityHandler = nil
            output = nil
            throw error
        }
        child = process
        group = process.processIdentifier
    }

    func stop(completion: @escaping () -> Void) {
        guard let child else { DispatchQueue.main.async(execute: completion); return }
        completions.append(completion)
        guard timer == nil else { return }
        deadline = .now() + 5
        forced = false
        // Before the helper establishes its group, terminating its PID is enough:
        // it has not spawned any subprocesses yet.
        if kill(-group, SIGTERM) != 0, child.isRunning { child.terminate() }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        self.timer = timer
        timer.schedule(deadline: .now(), repeating: .milliseconds(100))
        timer.setEventHandler { [weak self] in self?.checkStopped() }
        timer.resume()
    }

    private func checkStopped() {
        guard group > 0 else { return }
        let groupExists = group > 0 && kill(-group, 0) == 0
        if child?.isRunning == false && !groupExists {
            finish()
        } else if !forced && DispatchTime.now() >= deadline {
            forced = true
            kill(-group, SIGKILL)
            if let child, child.isRunning { kill(child.processIdentifier, SIGKILL) }
        } else if forced && child?.isRunning == false && DispatchTime.now() >= deadline + 2 {
            // Orphaned zombies can remain visible until launchd reaps them.
            // SIGKILL has already stopped every live member of this group.
            kill(-group, SIGKILL)
            finish()
        }
    }

    private func finish() {
        timer?.cancel()
        timer = nil
        output?.readabilityHandler = nil
        output?.closeFile()
        output = nil
        try? log?.close()
        log = nil
        child = nil
        group = 0
        let callbacks = completions
        completions.removeAll()
        onExit?()
        callbacks.forEach { $0() }
    }
}

final class RotatingLog {
    private let url: URL
    private let maximumBytes: UInt64 = 5 * 1024 * 1024
    private var handle: FileHandle

    init(url: URL) throws {
        self.url = url
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        handle = try FileHandle(forWritingTo: url)
        try handle.seekToEnd()
    }

    func write(_ data: Data) throws {
        let size = (try handle.offset())
        if size + UInt64(data.count) > maximumBytes {
            try handle.close()
            let manager = FileManager.default
            let first = URL(fileURLWithPath: url.path + ".1")
            let second = URL(fileURLWithPath: url.path + ".2")
            try? manager.removeItem(at: second)
            if manager.fileExists(atPath: first.path) { try manager.moveItem(at: first, to: second) }
            if manager.fileExists(atPath: url.path) { try manager.moveItem(at: url, to: first) }
            manager.createFile(atPath: url.path, contents: nil)
            handle = try FileHandle(forWritingTo: url)
        }
        try handle.write(contentsOf: data)
    }

    func close() throws { try handle.close() }
}
