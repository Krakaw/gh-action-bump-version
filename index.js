const { Toolkit } = require('actions-toolkit')
const { execSync } = require('child_process')
const fs = require('fs')
// Change working directory if user defined PACKAGEJSON_DIR
if (process.env.PACKAGEJSON_DIR) {
  process.env.GITHUB_WORKSPACE = `${process.env.GITHUB_WORKSPACE}/${process.env.PACKAGEJSON_DIR}`
  process.chdir(process.env.GITHUB_WORKSPACE)
}

// Run your GitHub Action!
Toolkit.run(async tools => {
  const pkg = tools.getPackageJSON()
  const event = tools.context.payload

  if (!event.commits) {
    console.log('Couldn\'t find any commits in this event, incrementing patch version...')
  }

  const messages = event.commits ? event.commits.map(commit => commit.message + '\n' + commit.body) : []

  const commitMessage = 'version bump to'
  const isVersionBump = messages.map(message => message.toLowerCase().includes(commitMessage)).includes(true)
  if (isVersionBump) {
    tools.exit.success('No action necessary!')
    return
  }

  let version = 'patch'
  if (messages.map(message => message.includes('BREAKING CHANGE') || message.includes('major')).includes(true)) {
    version = 'major'
  } else if (messages.map(
    message => message.toLowerCase().startsWith('feat') || message.toLowerCase().includes('minor')).includes(true)) {
    version = 'minor'
  }

  try {
    const current = pkg.version.toString()
    // set git user
    await tools.runInWorkspace('git', ['config', 'user.name', `"${process.env.GITHUB_USER || 'Automated Version Bump'}"`])
    await tools.runInWorkspace('git', ['config', 'user.email', `"${process.env.GITHUB_EMAIL || 'gh-action-bump-version@users.noreply.github.com'}"`])

    const currentBranch = /refs\/[a-zA-Z]+\/(.*)/.exec(process.env.GITHUB_REF)[1]
    console.log('currentBranch:', currentBranch)

    // do it in the current checked out github branch (DETACHED HEAD)
    // important for further usage of the package.json version
    await tools.runInWorkspace('npm',
      ['version', '--allow-same-version=true', '--git-tag-version=false', current])
    console.log('current:', current, '/', 'version:', version)
    let newVersion = execSync(`npm version --git-tag-version=false ${version}`).toString().trim()
    await tools.runInWorkspace('git', ['commit', '-a', '-m', `ci: ${commitMessage} ${newVersion}`])

    // now go to the actual branch to perform the same versioning
    await tools.runInWorkspace('git', ['checkout', currentBranch])
    await tools.runInWorkspace('npm',
      ['version', '--allow-same-version=true', '--git-tag-version=false', current])
    console.log('current:', current, '/', 'version:', version)
    newVersion = execSync(`npm version --git-tag-version=false ${version}`).toString().trim()
    newVersion = `${process.env['INPUT_TAG-PREFIX']}${newVersion}`
    console.log('new version:', newVersion)
    try {
      // to support "actions/checkout@v1"
      await tools.runInWorkspace('git', ['commit', '-a', '-m', `ci: ${commitMessage} ${newVersion}`])
    } catch (e) {
      console.warn('git commit failed because you are using "actions/checkout@v2"; ' +
        'but that doesnt matter because you dont need that git commit, thats only for "actions/checkout@v1"')
    }

    const remoteRepo = `git@github.com:${process.env.GITHUB_REPOSITORY}.git`
    const home = execSync('cd ~ && pwd').toString().trim()
    const keyPath = `${home}/id_rsa_deploy`
    fs.writeFileSync(keyPath, process.env.DEPLOY_PRIVATE_KEY)
    execSync(`chmod 600 ${keyPath}`)
    console.log(execSync(`ls -la ${keyPath}; wc ${keyPath}`).toString());
    try {
      console.log(execSync(`ssh -v -i ${keyPath} -o StrictHostKeyChecking=no -T git@github.com`).toString());
    }catch(e) {
      console.log(e)
    }

    await tools.runInWorkspace('git', ['config', 'core.sshCommand', `ssh -v -i ${keyPath} -o StrictHostKeyChecking=no`])
    await tools.runInWorkspace('git', ['remote', 'set-url', 'origin', remoteRepo])
    await tools.runInWorkspace('git', ['tag', newVersion])
    const pushOptions = ['push', '--follow-tags']
    if (process.env.FORCE_PUSH) {
      pushOptions.push('--force')
    }
    await tools.runInWorkspace('git', pushOptions)
    await tools.runInWorkspace('git', ['push', '--tags'])
  } catch (e) {
    tools.log.fatal(e)
    tools.exit.failure('Failed to bump version')
  }
  tools.exit.success('Version bumped!')
})
