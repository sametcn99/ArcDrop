import java.io.File
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction
import javax.inject.Inject
import org.gradle.process.ExecOperations

abstract class BuildTask : DefaultTask() {
    @get:Inject
    abstract val execOperations: ExecOperations

    @Input
    var rootDirRel: String? = null
    @Input
    var projectDir: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        val executable = resolveTauriCliExecutable();
        try {
            runTauriCli(executable)
        } catch (e: Exception) {
            if (Os.isFamily(Os.FAMILY_WINDOWS)) {
                // Try different Windows-specific extensions
                val fallbacks = listOf(
                    "$executable.exe",
                    "$executable.cmd",
                    "$executable.bat",
                )

                var lastException: Exception = e
                for (fallback in fallbacks) {
                    try {
                        runTauriCli(fallback)
                        return
                    } catch (fallbackException: Exception) {
                        lastException = fallbackException
                    }
                }
                throw lastException
            } else {
                throw e;
            }
        }
    }

    /**
     * `tauri android init` captures the absolute path of the CLI runner that
     * was used on the dev machine (a Windows bun path here). That absolute
     * path breaks on any other machine (CI runners are Linux). Resolution
     * order: explicit override -> bun/bunx found on PATH -> the path captured
     * at init time (last resort, keeps the original dev-machine behavior).
     */
    fun resolveTauriCliExecutable(): String {
        System.getenv("TAURI_CLI_EXECUTABLE")?.takeIf { it.isNotBlank() }?.let { return it }

        val pathDirs = (System.getenv("PATH") ?: "").split(File.pathSeparator)
        for (name in listOf("bun", "bun.exe", "bunx", "bunx.exe")) {
            for (dir in pathDirs) {
                val candidate = File(dir, name)
                if (candidate.isFile && candidate.canExecute()) {
                    return candidate.absolutePath
                }
            }
        }

        return """C:\Users\samet\.bun\bin\bun""";
    }

    fun runTauriCli(executable: String) {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val args = listOf("tauri", "android", "android-studio-script");

        execOperations.exec {
            workingDir(File(projectDir, rootDirRel))
            executable(executable)
            args(args)
            if (logger.isEnabled(LogLevel.DEBUG)) {
                args("-vv")
            } else if (logger.isEnabled(LogLevel.INFO)) {
                args("-v")
            }
            if (release) {
                args("--release")
            }
            args(listOf("--target", target))
        }.assertNormalExitValue()
    }
}