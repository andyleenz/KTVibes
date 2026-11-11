import Darwin
import Foundation

@main
enum ShutdownChecks {
    static func require(_ condition: Bool, _ message: String) {
        if !condition {
            fputs("FAIL: \(message)\n", stderr)
            exit(1)
        }
    }

    static func spin(until done: () -> Bool, timeout: TimeInterval = 10) {
        let deadline = Date().addingTimeInterval(timeout)
        while !done(), Date() < deadline {
            _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.01))
        }
        require(done(), "asynchronous operation exceeded its deadline")
    }

    static func scenario(_ name: String, body: String, immediate: Bool = false, force: Bool = false) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let script = directory.appendingPathComponent("server with spaces.sh")
        try body.write(to: script, atomically: true, encoding: .utf8)
        let server = ServerProcess()
        var completions = 0
        var stopping = false
        var output = ""
        var beats = 0
        var stoppedAt = Date()
        let heartbeat = DispatchSource.makeTimerSource(queue: .main)
        heartbeat.schedule(deadline: .now(), repeating: .milliseconds(10))
        heartbeat.setEventHandler { beats += 1 }
        heartbeat.resume()
        defer { heartbeat.cancel() }
        let stop = {
            guard !stopping else { return }
            stopping = true
            stoppedAt = Date()
            server.stop { completions += 1 }
            server.stop { completions += 1 }
        }
        server.onOutput = { text in
            output += text
            if output.contains("READY") { stop() }
        }
        try server.start(executable: URL(fileURLWithPath: CommandLine.arguments[0]), script: script,
                         environment: ProcessInfo.processInfo.environment,
                         logURL: directory.appendingPathComponent("logs/ktvibes.log"))
        if immediate { stop() }
        spin(until: { completions == 2 })
        require(beats > 0, "main queue did not respond during \(name)")
        if force {
            require(Date().timeIntervalSince(stoppedAt) >= 4.8, "force kill skipped grace period")
            require(beats > 100, "main queue blocked while waiting for forced shutdown")
        }
        if name == "shutdown output" {
            require(output.contains("DRAINED"), "shutdown output was not drained")
        }
        var stoppedAgain = false
        server.stop { stoppedAgain = true }
        spin(until: { stoppedAgain })
        print("PASS: \(name)")
    }

    static func main() throws {
        runServerHelperIfRequested()
        let logDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: logDirectory, withIntermediateDirectories: true)
        let logURL = logDirectory.appendingPathComponent("ktvibes.log")
        let log = try RotatingLog(url: logURL)
        let chunk = Data(repeating: 65, count: 1024 * 1024)
        for _ in 0..<16 { try log.write(chunk) }
        try log.close()
        let files = [logURL, URL(fileURLWithPath: logURL.path + ".1"), URL(fileURLWithPath: logURL.path + ".2")]
        require(files.allSatisfy { FileManager.default.fileExists(atPath: $0.path) }, "log rotation did not retain three files")
        require(try files.map { try Data(contentsOf: $0).count }.allSatisfy { $0 <= 5 * 1024 * 1024 }, "rotated log exceeded size cap")
        try? FileManager.default.removeItem(at: logDirectory)
        print("PASS: bounded log rotation")
        try scenario("normal shutdown", body: "trap 'exit 0' TERM\necho READY\nwhile :; do sleep 1; done\n")
        try scenario("shutdown output", body: "trap 'for ((i=0;i<30000;i++)); do printf \"shutdown output %0200d\\n\" $i; done; echo DRAINED; exit 0' TERM\necho READY\nwhile :; do sleep 1; done\n")
        try scenario("unresponsive process group", body: "trap '' TERM\nsleep 1000 &\necho READY\nwait\n", force: true)
        try scenario("stop during startup", body: "sleep 1000\n", immediate: true)
    }
}
