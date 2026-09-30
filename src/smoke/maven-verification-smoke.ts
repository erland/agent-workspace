import { loadModalConfig } from "../config/modal-config.js";
import { ModalSandboxProvider } from "../providers/modal/modal-sandbox-provider.js";
import { WorkspaceService } from "../workspace/workspace-service.js";
import { makeStoredZip } from "./zip-fixture.js";

function pomXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>se.example</groupId>
  <artifactId>agent-workspace-maven-smoke</artifactId>
  <version>1.0.0</version>
  <properties>
    <maven.compiler.release>21</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <junit.version>5.11.4</junit.version>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>\${junit.version}</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.13.0</version>
        <configuration><release>21</release></configuration>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.5.2</version>
      </plugin>
    </plugins>
  </build>
</project>`;
}

function archive(failing: boolean): Uint8Array {
  return makeStoredZip([
    { path: "pom.xml", content: pomXml() },
    {
      path: "src/main/java/se/example/Calculator.java",
      content: `package se.example; public class Calculator { public int add(int a,int b){ return a+b; } }\n`
    },
    {
      path: "src/test/java/se/example/CalculatorTest.java",
      content: failing
        ? `package se.example; import org.junit.jupiter.api.Test; import static org.junit.jupiter.api.Assertions.assertEquals; class CalculatorTest { @Test void adds(){ assertEquals(6,new Calculator().add(2,3)); } }\n`
        : `package se.example; import org.junit.jupiter.api.Test; import static org.junit.jupiter.api.Assertions.assertEquals; class CalculatorTest { @Test void adds(){ assertEquals(5,new Calculator().add(2,3)); } }\n`
    }
  ]);
}

async function verifyCase(service: WorkspaceService, failing: boolean): Promise<void> {
  const workspace = await service.create({ lifetimeMinutes: 5 });
  try {
    await service.uploadZip(workspace.id, archive(failing));
    const result = await service.verifyMaven(workspace.id);
    if (!failing) {
      if (result.status !== "PASSED") throw new Error(`Expected PASS, got ${JSON.stringify(result)}`);
      if (result.steps.map((step) => step.name).join(",") !== "test,package") {
        throw new Error(`Unexpected PASS steps: ${JSON.stringify(result.steps)}`);
      }
      console.log(`Maven PASS => ${result.steps.length} steps, ${result.durationMs} ms`);
    } else {
      if (result.status !== "FAILED" || result.failedStep !== "test" || result.exitCode === 0) {
        throw new Error(`Expected normalized Maven test failure, got ${JSON.stringify(result)}`);
      }
      if (!result.logExcerpt || result.logExcerpt.length === 0) {
        throw new Error("Expected Maven failure log excerpt");
      }
      console.log(`Maven FAIL => ${result.failedStep}, exit ${result.exitCode}`);
      console.log(`failure excerpt => ${result.logExcerpt}`);
    }
  } finally {
    const destroyed = await service.destroy(workspace.id);
    console.log(`workspace status => ${destroyed.status}`);
  }
}

async function main(): Promise<void> {
  const provider = new ModalSandboxProvider(loadModalConfig());
  const service = new WorkspaceService(provider);
  await verifyCase(service, false);
  await verifyCase(service, true);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
