plugins { kotlin("jvm") version "2.1.20" }
repositories { mavenCentral() }
kotlin { jvmToolchain(21) }
dependencies {
    compileOnly(fileTree("libs") { include("*.jar") })
    compileOnly("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.1")
    implementation("com.google.code.gson:gson:2.12.1")
}
tasks.jar {
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    from(configurations.runtimeClasspath.get().filter { it.name.startsWith("gson-") }.map { zipTree(it) })
    exclude("META-INF/*.SF", "META-INF/*.RSA", "META-INF/*.DSA")
}
