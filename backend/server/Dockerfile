FROM maven:3.9.12-eclipse-temurin-21 AS build
WORKDIR /workspace
COPY pom.xml ./
COPY backend ./backend
RUN mvn -B -pl backend/server -am package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN groupadd --system --gid 10001 queueflux \
    && useradd --system --uid 10001 --gid 10001 \
      --no-create-home --home-dir /nonexistent \
      --shell /usr/sbin/nologin queueflux
COPY --from=build --chown=10001:10001 /workspace/backend/server/target/server-*.jar /app/app.jar
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
