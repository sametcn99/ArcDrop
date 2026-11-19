// buildSrc resolves its `kotlin-dsl` plugin graph only through pluginManagement
// repositories; without this file it defaults to the Gradle Plugin Portal alone,
// which may 303-redirect Kotlin artifacts to Maven Central (Gradle reports them
// as missing). Mirroring the root buildscript repositories makes resolution robust.
pluginManagement {
    repositories {
        gradlePluginPortal()
        google()
        mavenCentral()
    }
}
