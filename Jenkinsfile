// MeetCon on built-in Jenkins: Git (user+PAT on SCM) + Secret file meetcon-production-env
// Deploys Docker stack on VM port 30098, then smoke test. Optional: MEETCON_SMOKE_FULL=1, MEETCON_ISOLATED_SIM=1

pipeline {
  agent { label 'built-in' }

  options {
    timestamps()
    disableConcurrentBuilds(abortPrevious: true)
    timeout(time: 120, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  environment {
    CI = 'true'
    DOCKER_BUILDKIT = '1'
    COMPOSE_DOCKER_CLI_BUILD = '1'
  }

  stages {
    stage('Checkout') {
      steps {
        retry(2) {
          deleteDir()
          checkout scm
        }
        sh 'git log -1 --oneline'
      }
    }

    stage('Deploy') {
      steps {
        script {
          def ciOnly = (env.MEETCON_CI_ONLY ?: '').trim().toLowerCase() in ['1', 'true', 'yes', 'on']
          def credId = (env.MEETCON_CREDS_ENV ?: 'meetcon-production-env').trim()
          if (ciOnly) {
            sh '''#!/usr/bin/env bash
              set -eu
              cd "${WORKSPACE}"
              chmod +x deploy/*.sh deploy/certs/*.sh 2>/dev/null || true
              MEETCON_CI_ONLY=1 bash deploy/jenkins-ci.sh
            '''
          } else {
            withCredentials([file(credentialsId: credId, variable: 'MEETCON_ENV_FILE')]) {
              sh '''#!/usr/bin/env bash
                set -eu
                cd "${WORKSPACE}"
                chmod +x deploy/*.sh deploy/certs/*.sh 2>/dev/null || true
                bash deploy/jenkins-ci.sh
              '''
            }
          }
        }
      }
    }
  }

  post {
    success {
      echo 'MeetCon is up on GATEWAY_PUBLIC_PORT (default 30098). Open WEB_ORIGIN from your env file.'
    }
    failure {
      echo 'Check: meetcon-production-env, WEB_ORIGIN includes :30098, jenkins in docker group.'
    }
  }
}
