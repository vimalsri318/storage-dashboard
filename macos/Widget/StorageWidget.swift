import WidgetKit
import SwiftUI

// Desktop / Notification Center widget. Reads the tiny /api/widget payload from the local Storage server,
// so the Storage app (menu bar) must be running for fresh numbers; the last good values are shown otherwise.

struct Snapshot: Codable {
    struct Top: Codable { var title: String; var kb: Double }
    var free: Double, total: Double, used: Double, safeKB: Double
    var openTasks: Int
    var topTask: Top?
    var updated: Double
    static let sample = Snapshot(free: 220e9, total: 494e9, used: 274e9, safeKB: 6.4e6, openTasks: 5,
                                 topTask: Top(title: "Clear Gradle caches", kb: 2.7e6), updated: 0)
    var usedFraction: Double { total > 0 ? used / total : 0 }
}
struct StorageEntry: TimelineEntry { let date: Date; let snap: Snapshot?; let stale: Bool }

enum Store {
    static let key = "last-snapshot"
    static var defaults: UserDefaults { .standard }
    static func save(_ d: Data) { defaults.set(d, forKey: key) }
    static func load() -> Snapshot? { defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(Snapshot.self, from: $0) } }
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> StorageEntry { StorageEntry(date: .now, snap: .sample, stale: false) }
    func getSnapshot(in context: Context, completion: @escaping (StorageEntry) -> Void) {
        if context.isPreview { completion(StorageEntry(date: .now, snap: .sample, stale: false)); return }
        fetch { completion($0) }
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<StorageEntry>) -> Void) {
        fetch { entry in completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(15 * 60)))) }
    }
    private func fetch(_ done: @escaping (StorageEntry) -> Void) {
        var req = URLRequest(url: URL(string: "http://127.0.0.1:4747/api/widget")!); req.timeoutInterval = 4
        URLSession.shared.dataTask(with: req) { data, _, _ in
            if let d = data, let s = try? JSONDecoder().decode(Snapshot.self, from: d) { Store.save(d); done(StorageEntry(date: .now, snap: s, stale: false)) }
            else { done(StorageEntry(date: .now, snap: Store.load(), stale: true)) }
        }.resume()
    }
}

let brand = Color(red: 0.18, green: 0.66, blue: 0.44)
func gb(_ bytes: Double) -> String { bytes >= 1e11 ? String(format: "%.0f GB", bytes / 1e9) : String(format: "%.1f GB", bytes / 1e9) }

struct Ring: View {
    let fraction: Double
    var color: Color { fraction > 0.9 ? .red : fraction > 0.8 ? .orange : brand }
    var body: some View {
        ZStack {
            Circle().stroke(Color.secondary.opacity(0.18), lineWidth: 10)
            Circle().trim(from: 0, to: fraction).stroke(color, style: StrokeStyle(lineWidth: 10, lineCap: .round)).rotationEffect(.degrees(-90))
        }
    }
}

struct WidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: StorageEntry
    var body: some View {
        if let s = entry.snap {
            if family == .systemSmall { small(s) } else { medium(s) }
        } else {
            VStack(spacing: 6) {
                Image(systemName: "internaldrive").font(.title2).foregroundStyle(brand)
                Text("Open Storage").font(.headline)
                Text("to start the first scan").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
    func small(_ s: Snapshot) -> some View {
        VStack(spacing: 8) {
            ZStack {
                Ring(fraction: s.usedFraction)
                VStack(spacing: 0) {
                    Text(gb(s.free)).font(.system(size: 17, weight: .bold, design: .rounded)).minimumScaleFactor(0.7)
                    Text("free").font(.caption2).foregroundStyle(.secondary)
                }
            }.padding(.horizontal, 6)
            Text(s.openTasks > 0 ? "\(gb(s.safeKB * 1024)) to clean" : "All tidy").font(.caption2.weight(.medium)).foregroundStyle(s.openTasks > 0 ? brand : .secondary)
        }
    }
    func medium(_ s: Snapshot) -> some View {
        HStack(spacing: 18) {
            ZStack {
                Ring(fraction: s.usedFraction)
                VStack(spacing: 0) {
                    Text(gb(s.free)).font(.system(size: 18, weight: .bold, design: .rounded)).minimumScaleFactor(0.7)
                    Text("free of \(gb(s.total))").font(.system(size: 9)).foregroundStyle(.secondary).minimumScaleFactor(0.7)
                }
            }.frame(width: 104, height: 104)
            VStack(alignment: .leading, spacing: 6) {
                HStack { Image(systemName: "internaldrive.fill").foregroundStyle(brand); Text("Storage").font(.headline) }
                Text("\(gb(s.safeKB * 1024)) safe to clean").font(.subheadline.weight(.semibold)).foregroundStyle(brand)
                Text("\(s.openTasks) task\(s.openTasks == 1 ? "" : "s") on your checklist").font(.caption).foregroundStyle(.secondary)
                if let t = s.topTask { Text("Next: \(t.title)").font(.caption).lineLimit(2) }
                if entry.stale { Text("Open Storage to refresh").font(.caption2).foregroundStyle(.orange) }
            }
            Spacer(minLength: 0)
        }
    }
}

struct StorageWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StorageWidget", provider: Provider()) { entry in
            WidgetView(entry: entry).containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("Storage")
        .description("Free space and what you can clean right now.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main struct StorageWidgets: WidgetBundle { var body: some Widget { StorageWidget() } }
